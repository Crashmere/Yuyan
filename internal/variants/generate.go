// Package variants makes and keeps the display versions of uploaded images: narrower copies, JPEG
// copies of photo-like lossless originals, and JPEG copies of screenshots for screens of 2x and
// more, offered to browsers through srcset. Originals stay unchanged and remain what exports,
// backups and "view original" use.
package variants

import (
	"bytes"
	"cmp"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math"

	_ "golang.org/x/image/bmp"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// Version changes whenever the policy below would produce different files; manifests of an older
// version are discarded and their images processed again.
const Version = 2

// Widths are the narrower versions offered below an image's own width. A full-width image needs
// about 1100–1300 pixels on a phone and up to 2200 in a 1100 px column on a 2x screen.
var Widths = []int{640, 1280, 1920}

// JPEG qualities tried in turn for a lossless original; lossy originals use the first.
var jpegQualities = []int{85, 90}

const (
	// Smaller originals would save too little per view to be worth a version.
	minBytes = 128 << 10
	// Decoding is bounded by pixels and by estimated decoded memory (a 4K screenshot fits); larger
	// images keep only the original. The service has 384 MiB in all.
	maxPixels  = 64 << 20
	maxDecoded = 40 << 20
	// A JPEG replaces a lossless original or version only when at most this share of its size, and
	// a narrower version is kept only when at most keepShare of the next wider candidate.
	lossyShare = 0.6
	keepShare  = 0.8
	// The JPEG must also stay close to the original (quality.go): on average, and in its worst 1%
	// of windows, where text and sharp edges show compression first. Most screenshots fail this
	// and keep lossless versions; one that passes once each 2×2 block is averaged, as a 2x screen
	// shows it, also gets JPEG versions for such screens.
	minSSIM      = 0.97
	minWorstSSIM = 0.85
)

// Output is one encoded version. For limits the screens it is offered to.
type Output struct {
	Width, Height int
	Data          []byte
	For           string
}

// Pages offer two ladders of versions: one to screens below 2x and one to screens of 2x and more,
// which may hold JPEGs that pass only at half size. For marks a version in one ladder only.
const (
	forLow  = "1x"
	forHigh = "2x"
)

// Result is what to keep for an original: the file type its versions share, apart from the JPEGs
// only for screens of 2x and more, and the versions, widest first. Note says why there are none.
// Width and Height are the upright size of the decoded original, and Pixels how many were decoded.
type Result struct {
	Type          string
	Outputs       []Output
	Note          string
	Width, Height int
	Pixels        int
}

// Generate makes the display versions of one original image. Errors are only for encoding
// failures; images that cannot or should not have versions return a Note instead.
func Generate(data []byte, ext string) (Result, error) {
	if len(data) < minBytes {
		return Result{Note: "small"}, nil
	}
	m := readMeta(data, ext)
	switch {
	case m.unsupported != "":
		return Result{Note: m.unsupported}, nil
	case m.animated:
		return Result{Note: "animated"}, nil
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return Result{Note: "decode"}, nil
	}
	if cfg.Width*cfg.Height > maxPixels || decodedBytes(cfg, m) > maxDecoded {
		return Result{Note: "large"}, nil
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return Result{Note: "decode"}, nil
	}
	switch src.(type) {
	case *image.CMYK:
		return Result{Note: "cmyk"}, nil
	case *image.Paletted:
		// Palette images are graphics already stored compactly.
		return Result{Note: "palette"}, nil
	}
	space := profileSpace(m.profile)
	gray := isGray(src) && space != "RGB "
	if m.profile != nil && space != "RGB " && (!gray || space != "GRAY") {
		return Result{Note: "profile"}, nil
	}
	opaque := isOpaque(src)
	src = orient(src, m.orientation, opaque)
	e := encoder{gray: gray, profile: m.profile, pngChunks: m.pngChunks}
	if ext != "png" && m.profile != nil {
		e.pngChunks = [][]byte{iccpChunk(m.profile)}
	}

	w0, h0 := src.Bounds().Dx(), src.Bounds().Dy()
	res := Result{Width: w0, Height: h0, Pixels: w0 * h0}
	next := len(data)
	// A JPEG competes with the best lossless file: for uncompressed BMP, a PNG of it.
	lossless := len(data)
	var fullPNG []byte
	if ext == "bmp" {
		if fullPNG, err = e.encode("png", src); err != nil {
			return Result{}, err
		}
		lossless = min(lossless, len(fullPNG))
	}
	// A JPEG that fails pixel for pixel may still pass at half size; fullDense is such a JPEG at
	// full width.
	var fullDense []byte
	if !m.lossy && opaque && !m.gammaOnly {
		var half *image.RGBA
		for _, q := range jpegQualities {
			e.quality = q
			full, err := e.encode("jpg", src)
			if err != nil {
				return Result{}, err
			}
			if float64(len(full)) > lossyShare*float64(lossless) {
				break
			}
			decoded, err := jpeg.Decode(bytes.NewReader(full))
			if err != nil {
				return Result{}, err
			}
			if compare(src, decoded).passes() {
				res.Type, next = "jpg", len(full)
				res.Outputs = append(res.Outputs, Output{w0, h0, full, ""})
				break
			}
			if fullDense == nil {
				if half == nil {
					half = halve(src)
				}
				if compare(half, halve(decoded)).passes() {
					fullDense = full
				}
			}
		}
		if res.Type == "" {
			e.quality = 0
		} else {
			fullDense = nil
		}
	}
	if res.Type == "" {
		res.Type = "png"
		if m.lossy && opaque {
			res.Type = "jpg"
		}
		// Uncompressed BMP gains even from a lossless full-width copy.
		if fullPNG != nil && float64(len(fullPNG)) <= lossyShare*float64(len(data)) {
			next = len(fullPNG)
			res.Outputs = append(res.Outputs, Output{w0, h0, fullPNG, ""})
		}
	}
	// The ladder for screens of 2x and more takes at each width the smaller of such a JPEG and the
	// version for every screen, so those screens never load more than others would. Narrower text
	// shows compression sooner, so each width is checked as shown. denseNext is the size of its
	// last candidate, as next is for the other ladder.
	dense := res.Type == "png" && !m.lossy && opaque && !m.gammaOnly
	denseNext := next
	if fullDense != nil {
		if len(res.Outputs) > 0 {
			res.Outputs[0].For = forLow
		}
		res.Outputs = append(res.Outputs, Output{w0, h0, fullDense, forHigh})
		denseNext = len(fullDense)
	}
	// Each width is scaled from the next wider one: cheaper than from the original each time, and
	// no step reduces by more than about half once the first is done.
	current := src
	for i := len(Widths) - 1; i >= 0; i-- {
		w := Widths[i]
		if w >= w0 {
			continue
		}
		h := max(1, int(math.Round(float64(h0)*float64(w)/float64(w0))))
		scaled := resize(current, w, h)
		current = scaled
		out, err := e.encode(res.Type, scaled)
		if err != nil {
			return Result{}, err
		}
		plain := -1
		if float64(len(out)) <= keepShare*float64(next) {
			next = len(out)
			plain = len(res.Outputs)
			res.Outputs = append(res.Outputs, Output{w, h, out, ""})
		}
		if !dense {
			continue
		}
		// A JPEG replaces the version at this width when at most lossyShare of it, and must
		// shrink like any narrower version to be stored.
		limit := keepShare * float64(denseNext)
		if plain >= 0 {
			limit = min(limit, lossyShare*float64(len(out)))
		}
		jpg, err := e.denseJPEG(scaled, limit)
		if err != nil {
			return Result{}, err
		}
		switch {
		case jpg != nil:
			if plain >= 0 {
				res.Outputs[plain].For = forLow
			}
			res.Outputs = append(res.Outputs, Output{w, h, jpg, forHigh})
			denseNext = len(jpg)
		case plain >= 0 && len(out) < denseNext:
			denseNext = len(out)
		case plain >= 0:
			res.Outputs[plain].For = forLow
		}
	}
	if len(res.Outputs) == 0 {
		return Result{Note: "none", Width: w0, Height: h0, Pixels: res.Pixels}, nil
	}
	return res, nil
}

type encoder struct {
	gray      bool
	profile   []byte
	pngChunks [][]byte
	quality   int
}

func (e encoder) encode(typ string, img image.Image) ([]byte, error) {
	if e.gray {
		img = toGray(img)
	} else if _, ok := img.(*image.RGBA); !ok && typ == "jpg" {
		// The JPEG encoder has fast paths for RGBA, YCbCr and Gray only.
		img = toRGBA(img, true)
	}
	var b bytes.Buffer
	if typ == "jpg" {
		if err := jpeg.Encode(&b, img, &jpeg.Options{Quality: cmp.Or(e.quality, jpegQualities[0])}); err != nil {
			return nil, err
		}
		return withJPEGProfile(b.Bytes(), e.profile), nil
	}
	if err := (&png.Encoder{CompressionLevel: png.DefaultCompression}).Encode(&b, img); err != nil {
		return nil, err
	}
	return withPNGChunks(b.Bytes(), e.pngChunks), nil
}

// denseJPEG returns a JPEG of img for screens of 2x and more, at the first quality that passes as
// they show it, or nil when none does within limit bytes.
func (e encoder) denseJPEG(img image.Image, limit float64) ([]byte, error) {
	var half *image.RGBA
	for _, q := range jpegQualities {
		e.quality = q
		out, err := e.encode("jpg", img)
		if err != nil {
			return nil, err
		}
		if float64(len(out)) > limit {
			return nil, nil
		}
		decoded, err := jpeg.Decode(bytes.NewReader(out))
		if err != nil {
			return nil, err
		}
		if half == nil {
			half = halve(img)
		}
		if compare(half, halve(decoded)).passes() {
			return out, nil
		}
	}
	return nil, nil
}

// decodedBytes estimates the memory a decode and the conversions after it need.
func decodedBytes(cfg image.Config, m meta) int {
	per := 4
	switch model := cfg.ColorModel.(type) {
	case color.Palette:
		per = 1
	default:
		switch model {
		case color.GrayModel:
			per = 1
		case color.Gray16Model:
			per = 3
		case color.YCbCrModel:
			per = 3
		case color.RGBA64Model, color.NRGBA64Model:
			per = 12
		}
	}
	if m.orientation > 1 {
		per += 8
	}
	return cfg.Width * cfg.Height * per
}

func isGray(img image.Image) bool {
	switch img.(type) {
	case *image.Gray, *image.Gray16:
		return true
	}
	return false
}

func isOpaque(img image.Image) bool {
	if o, ok := img.(interface{ Opaque() bool }); ok {
		return o.Opaque()
	}
	return false
}

// toRGBA returns img as RGBA, sharing the pixels of an opaque NRGBA image, whose bytes are the same.
func toRGBA(img image.Image, opaque bool) *image.RGBA {
	switch s := img.(type) {
	case *image.RGBA:
		return s
	case *image.NRGBA:
		if opaque {
			return &image.RGBA{Pix: s.Pix, Stride: s.Stride, Rect: s.Rect}
		}
	}
	b := img.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(dst, dst.Bounds(), img, b.Min, draw.Src)
	return dst
}

func toGray(img image.Image) *image.Gray {
	if g, ok := img.(*image.Gray); ok {
		return g
	}
	b := img.Bounds()
	dst := image.NewGray(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(dst, dst.Bounds(), img, b.Min, draw.Src)
	return dst
}

// orient turns the pixels upright by EXIF orientation, so versions display like the original
// without carrying the tag.
func orient(img image.Image, o int, opaque bool) image.Image {
	if o <= 1 {
		return img
	}
	s := toRGBA(img, opaque)
	w, h := s.Rect.Dx(), s.Rect.Dy()
	dw, dh := w, h
	if o >= 5 {
		dw, dh = h, w
	}
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	for y := range h {
		for x := range w {
			var dx, dy int
			switch o {
			case 2:
				dx, dy = w-1-x, y
			case 3:
				dx, dy = w-1-x, h-1-y
			case 4:
				dx, dy = x, h-1-y
			case 5:
				dx, dy = y, x
			case 6:
				dx, dy = h-1-y, x
			case 7:
				dx, dy = h-1-y, w-1-x
			case 8:
				dx, dy = y, w-1-x
			}
			copy(dst.Pix[dy*dst.Stride+dx*4:][:4], s.Pix[y*s.Stride+x*4:][:4])
		}
	}
	return dst
}
