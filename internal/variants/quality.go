package variants

import (
	"image"
	"image/color"
	"slices"
)

// SSIM is computed over 8×8 windows, each scored by its worst colour channel so that coloured
// text counts. Unlike PSNR it weighs an error against the local contrast: grain and texture hide
// compression, flat areas and text edges show it. A window whose error is below what anyone can
// see (PSNR 40 dB) scores 1: SSIM alone reads faint noise smoothed out of a flat area as lost
// structure.
const (
	window       = 8
	invisibleMSE = 255 * 255 / 1e4
)

// score is how close a JPEG stays to the image it was made from: the mean SSIM, and the SSIM of
// the worst 1% of windows, where text and sharp edges show compression first.
type score struct{ mean, worst float64 }

func (s score) passes() bool { return s.mean >= minSSIM && s.worst >= minWorstSSIM }

// compare scores got, a decoded JPEG or its halved copy, against ref of the same size. An empty
// image, such as one pixel high once halved, fails.
func compare(ref, got image.Image) score {
	b := ref.Bounds()
	w, h := b.Dx(), b.Dy()
	if w == 0 || h == 0 {
		return score{}
	}
	channels := 3
	var pix []uint8
	stride := 0
	if isGray(ref) {
		g := toGray(ref)
		channels, pix, stride = 1, g.Pix, g.Stride
	} else {
		rgba := toRGBA(ref, true)
		pix, stride = rgba.Pix, rgba.Stride
	}
	ycc, _ := got.(*image.YCbCr)
	gray, _ := got.(*image.Gray)
	rgba, _ := got.(*image.RGBA)
	sample := func(x, y int, out *[3][2]float64) {
		var r, g, bl uint8
		switch {
		case ycc != nil:
			yi, ci := ycc.YOffset(x, y), ycc.COffset(x, y)
			r, g, bl = color.YCbCrToRGB(ycc.Y[yi], ycc.Cb[ci], ycc.Cr[ci])
		case gray != nil:
			v := gray.Pix[y*gray.Stride+x]
			r, g, bl = v, v, v
		case rgba != nil:
			p := rgba.Pix[y*rgba.Stride+x*4:]
			r, g, bl = p[0], p[1], p[2]
		default:
			r32, g32, b32, _ := got.At(x, y).RGBA()
			r, g, bl = uint8(r32>>8), uint8(g32>>8), uint8(b32>>8)
		}
		if channels == 1 {
			out[0] = [2]float64{float64(pix[y*stride+x]), float64(r)}
			return
		}
		p := pix[y*stride+x*4:]
		out[0] = [2]float64{float64(p[0]), float64(r)}
		out[1] = [2]float64{float64(p[1]), float64(g)}
		out[2] = [2]float64{float64(p[2]), float64(bl)}
	}
	const c1, c2 = (0.01 * 255) * (0.01 * 255), (0.03 * 255) * (0.03 * 255)
	var scores []float64
	var px [3][2]float64
	for wy := 0; wy < h; wy += window {
		for wx := 0; wx < w; wx += window {
			var sx, sy, sxx, syy, sxy [3]float64
			var errSum float64
			n := 0
			for y := wy; y < min(h, wy+window); y++ {
				for x := wx; x < min(w, wx+window); x++ {
					sample(x, y, &px)
					for c := range channels {
						a, d := px[c][0], px[c][1]
						sx[c] += a
						sy[c] += d
						sxx[c] += a * a
						syy[c] += d * d
						sxy[c] += a * d
						errSum += (a - d) * (a - d) / float64(channels)
					}
					n++
				}
			}
			s := 1.0
			if errSum/float64(n) <= invisibleMSE {
				scores = append(scores, s)
				continue
			}
			for c := range channels {
				fn := float64(n)
				mx, my := sx[c]/fn, sy[c]/fn
				vx, vy, cov := sxx[c]/fn-mx*mx, syy[c]/fn-my*my, sxy[c]/fn-mx*my
				s = min(s, (2*mx*my+c1)*(2*cov+c2)/((mx*mx+my*my+c1)*(vx+vy+c2)))
			}
			scores = append(scores, s)
		}
	}
	var sum float64
	for _, s := range scores {
		sum += s
	}
	slices.Sort(scores)
	return score{mean: sum / float64(len(scores)), worst: scores[len(scores)/100]}
}

// halve averages each 2×2 block of an opaque image. That is about what a screen of 2x or more
// shows of a version laid out at half its pixel width: artefacts that stand out pixel for pixel
// blend there, as they do in a photo.
func halve(img image.Image) *image.RGBA {
	b := img.Bounds()
	w, h := b.Dx()/2, b.Dy()/2
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	top, bottom := make([]float32, 4*b.Dx()), make([]float32, 4*b.Dx())
	for y := range h {
		readRow(img, b.Min.Y+2*y, top)
		readRow(img, b.Min.Y+2*y+1, bottom)
		pix := dst.Pix[y*dst.Stride:]
		for i := range 4 * w {
			j := i/4*8 + i%4
			pix[i] = clamp8((top[j] + top[j+4] + bottom[j] + bottom[j+4]) / 4)
		}
	}
	return dst
}
