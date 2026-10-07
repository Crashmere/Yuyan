// Package drawing defines the immutable, portable drawing package. The renderer
// is a browser dependency; the server validates data, never executes the scene.
package drawing

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/png"
	"math"
	"regexp"
	"strings"
)

const Mime = "application/vnd.yuyan.drawing+json"
const MaxBytes = 12 << 20
const EngineVersion = "0.18.1"

var Source = regexp.MustCompile(`^/drawings/([0-9a-f]{32})$`)
var ImageSource = regexp.MustCompile(`^/assets/([0-9a-f]{32})\.(png|jpg|gif|webp|bmp)$`)
var identifier = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)
var colour = regexp.MustCompile(`^#[a-fA-F0-9]{6}$`)

type File struct {
	Src      string `json:"src"`
	MimeType string `json:"mimeType"`
}
type Preview struct {
	Mime   string `json:"mime"`
	Data   string `json:"data"` // SVG text, or base64 PNG (no data URL).
	Width  int    `json:"width"`
	Height int    `json:"height"`
}
type Package struct {
	Format        string          `json:"format"`
	Version       int             `json:"version"`
	Engine        string          `json:"engine"`
	EngineVersion string          `json:"engineVersion"`
	Scene         map[string]any  `json:"scene"`
	Files         map[string]File `json:"files"`
	Preview       Preview         `json:"preview"`
	SceneHash     string          `json:"sceneHash"`
	Text          string          `json:"text"`
}

// Decode verifies the storage envelope and the supported scene subset. Derived
// text/hash are always computed by the server, including on portable reimport.
func Decode(data []byte) (Package, error) {
	var p Package
	if len(data) > MaxBytes || json.Unmarshal(data, &p) != nil {
		return p, errors.New("invalid drawing package")
	}
	if p.Format != "yuyan-drawing" || p.Version != 1 || p.Engine != "excalidraw" || p.EngineVersion != EngineVersion {
		return p, errors.New("unsupported drawing format or engine version")
	}
	if p.Files == nil {
		p.Files = map[string]File{}
	}
	elements, ok := p.Scene["elements"].([]any)
	if !ok || len(elements) == 0 || len(elements) > 10000 || len(p.Scene) != 2 {
		return p, errors.New("drawing must contain 1–10000 elements")
	}
	state, ok := p.Scene["appState"].(map[string]any)
	if !ok || len(state) != 1 || !colour.MatchString(str(state["viewBackgroundColor"])) {
		return p, errors.New("invalid drawing background")
	}
	ids, used := map[string]bool{}, map[string]bool{}
	var text []string
	for _, raw := range elements {
		e, ok := raw.(map[string]any)
		if !ok || !identifier.MatchString(str(e["id"])) || ids[str(e["id"])] || e["isDeleted"] == true {
			return p, errors.New("invalid or duplicate drawing element")
		}
		ids[str(e["id"])] = true
		switch str(e["type"]) {
		case "rectangle", "ellipse", "diamond", "line", "arrow", "freedraw", "frame":
		case "text":
			if _, ok := e["text"].(string); !ok {
				return p, errors.New("invalid drawing text")
			}
			text = append(text, str(e["text"]))
		case "image":
			id := str(e["fileId"])
			if !identifier.MatchString(id) {
				return p, errors.New("missing drawing image")
			}
			used[id] = true
		default:
			return p, errors.New("unsupported drawing element")
		}
		for _, key := range []string{"x", "y", "width", "height", "angle"} {
			v, ok := e[key].(float64)
			if !ok || math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > 1000000 || ((key == "width" || key == "height") && v < 0) {
				return p, fmt.Errorf("invalid drawing geometry: %s", key)
			}
		}
		if raw, exists := e["points"]; exists {
			points, ok := raw.([]any)
			if !ok || len(points) > 10000 {
				return p, errors.New("invalid drawing points")
			}
			for _, raw := range points {
				point, ok := raw.([]any)
				if !ok || len(point) != 2 {
					return p, errors.New("invalid drawing point")
				}
				for _, raw := range point {
					v, ok := raw.(float64)
					if !ok || math.Abs(v) > 1000000 {
						return p, errors.New("invalid drawing point coordinate")
					}
				}
			}
		}
		// External embeds, links and arbitrary application data are not part of v1.
		for _, key := range []string{"link", "customData"} {
			if e[key] != nil {
				return p, fmt.Errorf("unsupported drawing property: %s", key)
			}
		}
	}
	if len(used) != len(p.Files) {
		return p, errors.New("unused or missing drawing images")
	}
	for id, file := range p.Files {
		if !used[id] || !ImageSource.MatchString(file.Src) || !strings.HasPrefix(file.MimeType, "image/") {
			return p, errors.New("invalid drawing image reference")
		}
	}
	if len(p.Files) != 0 && p.Preview.Mime != "image/png" {
		return p, errors.New("drawings with images need a PNG preview")
	}
	if err := ValidatePreview(p.Preview); err != nil {
		return p, err
	}
	canonical, err := json.Marshal(struct {
		Scene map[string]any  `json:"scene"`
		Files map[string]File `json:"files"`
	}{p.Scene, p.Files})
	if err != nil {
		return p, err
	}
	hash := sha256.Sum256(canonical)
	p.SceneHash = hex.EncodeToString(hash[:])
	p.Text = strings.Join(text, "\n")
	if len(p.Text) > 200000 {
		return p, errors.New("drawing text too long")
	}
	return p, nil
}

func str(v any) string { s, _ := v.(string); return s }

func (p Package) PreviewBytes() []byte {
	if p.Preview.Mime == "image/svg+xml" {
		return []byte(p.Preview.Data)
	}
	b, _ := base64.StdEncoding.DecodeString(p.Preview.Data)
	return b
}

// ValidatePreview is independent of scene/engine versions so a newer drawing
// remains readable after rollback without executing its scene.
func ValidatePreview(preview Preview) error {
	p := Package{Preview: preview}
	if p.Preview.Width < 1 || p.Preview.Height < 1 || p.Preview.Width > 16384 || p.Preview.Height > 16384 {
		return errors.New("invalid drawing preview size")
	}
	switch p.Preview.Mime {
	case "image/svg+xml":
		if err := validateSVG(p.Preview); err != nil {
			return err
		}
	case "image/png":
		data, err := base64.StdEncoding.DecodeString(p.Preview.Data)
		if err != nil {
			return errors.New("invalid preview encoding")
		}
		cfg, kind, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || kind != "png" || cfg.Width != p.Preview.Width || cfg.Height != p.Preview.Height || cfg.Width*cfg.Height > 16000000 {
			return errors.New("invalid PNG preview")
		}
	default:
		return errors.New("unsupported drawing preview")
	}
	return nil
}
