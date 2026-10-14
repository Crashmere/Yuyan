package variants

import (
	"image"
	"image/color"
	"math"
)

// resize scales src down to w×h with the Catmull-Rom kernel, using the weights of
// draw.CatmullRom.Scale. That keeps a float64 copy of the whole source height at the new width,
// 170 MiB for a 3600×2900 original; this keeps only the source rows one output row needs, already
// scaled across.
func resize(src image.Image, w, h int) *image.RGBA {
	b := src.Bounds()
	cols, rows := spans(w, b.Dx()), spans(h, b.Dy())
	depth := 1
	for _, s := range rows {
		depth = max(depth, s.end-s.taps[0].at)
	}
	ring := make([][]float32, depth)
	for i := range ring {
		ring[i] = make([]float32, 4*w)
	}
	line := make([]float32, 4*b.Dx())
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	next := 0
	for y, s := range rows {
		// Rows enter in order and each output row starts no higher than the one before, so a
		// ring as deep as the tallest span holds every row the current span reads.
		for ; next < s.end; next++ {
			readRow(src, b.Min.Y+next, line)
			out := ring[next%depth]
			for x, c := range cols {
				var r, g, bl, a float32
				for _, t := range c.taps {
					p := line[4*t.at:]
					r += p[0] * t.weight
					g += p[1] * t.weight
					bl += p[2] * t.weight
					a += p[3] * t.weight
				}
				out[4*x], out[4*x+1], out[4*x+2], out[4*x+3] = r, g, bl, a
			}
		}
		pix := dst.Pix[y*dst.Stride:]
		for x := range w {
			var r, g, bl, a float32
			for _, t := range s.taps {
				p := ring[t.at%depth][4*x:]
				r += p[0] * t.weight
				g += p[1] * t.weight
				bl += p[2] * t.weight
				a += p[3] * t.weight
			}
			// The kernel's negative lobes can overshoot; premultiplied colour stays within alpha.
			av := clamp8(a)
			pix[4*x+0] = min(clamp8(r), av)
			pix[4*x+1] = min(clamp8(g), av)
			pix[4*x+2] = min(clamp8(bl), av)
			pix[4*x+3] = av
		}
	}
	return dst
}

func clamp8(v float32) uint8 {
	return uint8(max(0, min(255, v+0.5)))
}

type tap struct {
	at     int
	weight float32
}

// span lists the source pixels one output pixel takes, with weights summing to 1; end is one past
// the last.
type span struct {
	taps []tap
	end  int
}

// spans distributes sw source pixels over dw output pixels as draw.CatmullRom does: the kernel
// widens by the reduction factor, and taps cut off at the edges are left out with the rest
// renormalised.
func spans(dw, sw int) []span {
	scale := float64(sw) / float64(dw)
	half, arg := 2.0, 1.0
	if scale > 1 {
		half *= scale
		arg = 1 / scale
	}
	out := make([]span, dw)
	for x := range out {
		center := (float64(x)+0.5)*scale - 0.5
		lo, hi := max(0, int(math.Floor(center-half))), min(sw, int(math.Ceil(center+half)))
		taps := make([]tap, 0, hi-lo)
		total := 0.0
		for i := lo; i < hi; i++ {
			t := math.Abs((center - float64(i)) * arg)
			if t >= 2 {
				continue
			}
			var k float64
			if t < 1 {
				k = (1.5*t-2.5)*t*t + 1
			} else {
				k = ((-0.5*t+2.5)*t-4)*t + 2
			}
			if k == 0 {
				continue
			}
			total += k
			taps = append(taps, tap{i, float32(k)})
		}
		for i := range taps {
			taps[i].weight /= float32(total)
		}
		out[x] = span{taps, taps[len(taps)-1].at + 1}
	}
	return out
}

// readRow stores row y of img in line as premultiplied RGBA from 0 to 255.
func readRow(img image.Image, y int, line []float32) {
	b := img.Bounds()
	switch s := img.(type) {
	case *image.RGBA:
		p := s.Pix[(y-b.Min.Y)*s.Stride:]
		for i := range line {
			line[i] = float32(p[i])
		}
	case *image.NRGBA:
		p := s.Pix[(y-b.Min.Y)*s.Stride:]
		for i := 0; i < len(line); i += 4 {
			a := float32(p[i+3])
			line[i] = float32(p[i]) * a / 255
			line[i+1] = float32(p[i+1]) * a / 255
			line[i+2] = float32(p[i+2]) * a / 255
			line[i+3] = a
		}
	case *image.Gray:
		p := s.Pix[(y-b.Min.Y)*s.Stride:]
		for x := range len(line) / 4 {
			v := float32(p[x])
			line[4*x], line[4*x+1], line[4*x+2], line[4*x+3] = v, v, v, 255
		}
	case *image.YCbCr:
		for x := range len(line) / 4 {
			yi, ci := s.YOffset(b.Min.X+x, y), s.COffset(b.Min.X+x, y)
			r, g, bl := color.YCbCrToRGB(s.Y[yi], s.Cb[ci], s.Cr[ci])
			line[4*x], line[4*x+1], line[4*x+2], line[4*x+3] = float32(r), float32(g), float32(bl), 255
		}
	default:
		for x := range len(line) / 4 {
			r, g, bl, a := img.At(b.Min.X+x, y).RGBA()
			line[4*x], line[4*x+1], line[4*x+2], line[4*x+3] = float32(r)/257, float32(g)/257, float32(bl)/257, float32(a)/257
		}
	}
}
