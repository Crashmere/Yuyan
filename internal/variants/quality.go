package variants

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"math"
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

// fidelity compares an encoded JPEG with the image it was made from: the PSNR in dB, the mean
// SSIM, and the SSIM of the worst 1% of windows, where text and sharp edges show compression first.
func fidelity(src image.Image, jpg []byte) (psnrAll, mean, worst float64, err error) {
	decoded, err := jpeg.Decode(bytes.NewReader(jpg))
	if err != nil {
		return 0, 0, 0, err
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	channels := 3
	var ref []uint8
	refStride := 0
	if isGray(src) {
		g := toGray(src)
		channels, ref, refStride = 1, g.Pix, g.Stride
	} else {
		rgba := toRGBA(src, true)
		ref, refStride = rgba.Pix, rgba.Stride
	}
	ycc, _ := decoded.(*image.YCbCr)
	dgray, _ := decoded.(*image.Gray)
	sample := func(x, y int, out *[3][2]float64) {
		var r, g, bl uint8
		switch {
		case ycc != nil:
			yi, ci := ycc.YOffset(x, y), ycc.COffset(x, y)
			r, g, bl = color.YCbCrToRGB(ycc.Y[yi], ycc.Cb[ci], ycc.Cr[ci])
		case dgray != nil:
			v := dgray.Pix[y*dgray.Stride+x]
			r, g, bl = v, v, v
		default:
			r32, g32, b32, _ := decoded.At(x, y).RGBA()
			r, g, bl = uint8(r32>>8), uint8(g32>>8), uint8(b32>>8)
		}
		if channels == 1 {
			out[0] = [2]float64{float64(ref[y*refStride+x]), float64(r)}
			return
		}
		p := ref[y*refStride+x*4:]
		out[0] = [2]float64{float64(p[0]), float64(r)}
		out[1] = [2]float64{float64(p[1]), float64(g)}
		out[2] = [2]float64{float64(p[2]), float64(bl)}
	}
	const c1, c2 = (0.01 * 255) * (0.01 * 255), (0.03 * 255) * (0.03 * 255)
	var scores []float64
	var total float64
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
			total += errSum
			score := 1.0
			if errSum/float64(n) <= invisibleMSE {
				scores = append(scores, score)
				continue
			}
			for c := range channels {
				fn := float64(n)
				mx, my := sx[c]/fn, sy[c]/fn
				vx, vy, cov := sxx[c]/fn-mx*mx, syy[c]/fn-my*my, sxy[c]/fn-mx*my
				s := (2*mx*my + c1) * (2*cov + c2) / ((mx*mx + my*my + c1) * (vx + vy + c2))
				score = min(score, s)
			}
			scores = append(scores, score)
		}
	}
	var sum float64
	for _, s := range scores {
		sum += s
	}
	mean = sum / float64(len(scores))
	slices.Sort(scores)
	worst = scores[len(scores)/100]
	mse := total / float64(w*h)
	psnrAll = 99
	if mse > 0 {
		psnrAll = 10 * math.Log10(255*255/mse)
	}
	return psnrAll, mean, worst, nil
}
