package server

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path"
	"regexp"

	"github.com/Crashmere/Yuyan/internal/doc"
	"github.com/Crashmere/Yuyan/internal/store"
	"github.com/Crashmere/Yuyan/internal/variants"
)

// imageSize is what a page learns about an uploaded image: its pixel size, to keep its space before
// it loads, and the display versions browsers may choose from (internal/variants). It is sent as
// [width, height] or [width, height, files]; a file such as "1280.jpg" is served as
// assets/<id>-1280.jpg.
type imageSize struct {
	width, height int
	files         []string
}

func (v imageSize) MarshalJSON() ([]byte, error) {
	if len(v.files) == 0 {
		return json.Marshal([2]int{v.width, v.height})
	}
	return json.Marshal([]any{v.width, v.height, v.files})
}

// images describes the given uploaded images, keyed by asset id. Images still without display
// versions are queued, so the next reader gets them.
func (s *Server) images(ctx context.Context, ids []string) (map[string]imageSize, error) {
	assets, err := s.store.AssetSizes(ctx, ids)
	if err != nil {
		return nil, err
	}
	sizes := make(map[string]imageSize, len(assets))
	for id, a := range assets {
		files, known := s.variants.Files(id)
		if !known {
			s.variants.Request(variants.Asset{ID: id, Ext: a.Ext, Size: a.Size})
		}
		sizes[id] = imageSize{a.Width, a.Height, files}
	}
	return sizes, nil
}

// imageSizes describes the uploaded images of a document.
func (s *Server) imageSizes(r *http.Request, n doc.Node) (map[string]imageSize, error) {
	return s.images(r.Context(), doc.AssetIDs(n))
}

// UseVariants serves and requests display versions from c.
func (s *Server) UseVariants(c *variants.Cache) { s.variants = c }

// VariantSource lets the display versions read the stored originals.
func VariantSource(st *store.Store) variants.Source { return variantSource{st} }

type variantSource struct{ *store.Store }

func (v variantSource) ImageAssets(ctx context.Context) ([]variants.Asset, error) {
	list, err := v.Store.ImageAssets(ctx)
	assets := make([]variants.Asset, len(list))
	for i, a := range list {
		assets[i] = variants.Asset{ID: a.ID, Ext: a.Ext, Size: a.Size}
	}
	return assets, err
}

var variantName = regexp.MustCompile(`^([0-9a-f]{32})-([1-9][0-9]{0,4}\.(?:jpg|png))$`)

// variantFile serves a display version. The versions are a cache that may lack a file at any
// time, after a restore for example; the browser is then sent to the original.
func (s *Server) variantFile(w http.ResponseWriter, r *http.Request, id, file string) {
	if p, ok := s.variants.Path(id, file); ok {
		f, err := os.Open(p)
		if err == nil {
			defer f.Close()
			if info, err := f.Stat(); err == nil {
				w.Header().Set("Content-Type", assetTypes[path.Ext(file)[1:]])
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				http.ServeContent(w, r, "", info.ModTime(), f)
				return
			}
		}
		s.variants.Forget(id)
	}
	a, err := s.store.GetAsset(r.Context(), id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, s.base+"assets/"+a.ID+"."+a.Ext, http.StatusFound)
}
