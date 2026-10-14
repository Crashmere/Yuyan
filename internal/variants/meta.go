package variants

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"hash/crc32"
	"io"
)

// meta is what Go's decoders drop but a faithful display version must keep: how the colours are
// meant, which way is up, and whether the image moves.
type meta struct {
	animated bool
	lossy    bool
	// profile is the embedded ICC profile, uncompressed.
	profile []byte
	// pngChunks are the source's colour chunks (iCCP, sRGB, gAMA, cHRM), copied into PNG outputs.
	pngChunks [][]byte
	// gammaOnly marks gAMA or cHRM without sRGB or iCCP: only a PNG output can carry it.
	gammaOnly   bool
	orientation int
	// unsupported names a reason to leave the image without display versions.
	unsupported string
}

func readMeta(data []byte, ext string) meta {
	switch ext {
	case "png":
		return pngMeta(data)
	case "jpg":
		return jpegMeta(data)
	case "webp":
		return webpMeta(data)
	case "bmp":
		return meta{orientation: 1}
	}
	return meta{unsupported: "type"}
}

func pngMeta(data []byte) meta {
	m := meta{orientation: 1}
	var icc, srgb, gamma bool
chunks:
	for p := 8; p+12 <= len(data); {
		n := int(binary.BigEndian.Uint32(data[p:]))
		if n < 0 || p+12+n > len(data) {
			break
		}
		body, chunk := data[p+8:p+8+n], data[p:p+12+n]
		switch string(data[p+4 : p+8]) {
		case "IDAT", "IEND":
			break chunks
		case "acTL":
			m.animated = true
		case "iCCP":
			icc = true
			m.pngChunks = append(m.pngChunks, chunk)
			if i := bytes.IndexByte(body, 0); i >= 0 && i+2 <= len(body) {
				m.profile = inflate(body[i+2:])
			}
		case "sRGB":
			srgb = true
			m.pngChunks = append(m.pngChunks, chunk)
		case "gAMA", "cHRM":
			gamma = true
			m.pngChunks = append(m.pngChunks, chunk)
		case "cICP", "mDCV", "mDCv", "cLLI", "cLLi":
			m.unsupported = "hdr"
		case "eXIf":
			if exifOrientation(body) > 1 {
				m.unsupported = "orientation"
			}
		}
		p += 12 + n
	}
	if icc && m.profile == nil {
		m.unsupported = "profile"
	}
	m.gammaOnly = gamma && !srgb && !icc
	return m
}

func jpegMeta(data []byte) meta {
	m := meta{orientation: 1, lossy: true}
	var parts [][]byte
	for p := 2; p+4 <= len(data) && data[p] == 0xFF; {
		marker := data[p+1]
		if marker == 0xFF {
			p++
			continue
		}
		if marker == 0xDA || marker == 0xD9 {
			break
		}
		n := int(binary.BigEndian.Uint16(data[p+2:]))
		if n < 2 || p+2+n > len(data) {
			break
		}
		seg := data[p+4 : p+2+n]
		switch {
		case marker == 0xE2 && len(seg) >= 14 && bytes.HasPrefix(seg, []byte("ICC_PROFILE\x00")):
			seq, count := int(seg[12]), int(seg[13])
			if count == 0 || seq == 0 || seq > count || (parts != nil && len(parts) != count) {
				m.unsupported = "profile"
				break
			}
			if parts == nil {
				parts = make([][]byte, count)
			}
			parts[seq-1] = seg[14:]
		case marker == 0xE1 && bytes.HasPrefix(seg, []byte("Exif\x00\x00")):
			if o := exifOrientation(seg[6:]); o > 0 {
				m.orientation = o
			}
		}
		p += 2 + n
	}
	for _, part := range parts {
		if part == nil {
			m.unsupported = "profile"
			return m
		}
		m.profile = append(m.profile, part...)
	}
	return m
}

func webpMeta(data []byte) meta {
	m := meta{orientation: 1}
	for p := 12; p+8 <= len(data); {
		n := int(binary.LittleEndian.Uint32(data[p+4:]))
		if n < 0 || p+8+n > len(data) {
			break
		}
		body := data[p+8 : p+8+n]
		switch string(data[p : p+4]) {
		case "ICCP":
			m.profile = body
		case "ANIM", "ANMF":
			m.animated = true
		case "VP8 ":
			m.lossy = true
		case "EXIF":
			if exifOrientation(bytes.TrimPrefix(body, []byte("Exif\x00\x00"))) > 1 {
				m.unsupported = "orientation"
			}
		}
		p += 8 + n + n&1
	}
	return m
}

func inflate(b []byte) []byte {
	r, err := zlib.NewReader(bytes.NewReader(b))
	if err != nil {
		return nil
	}
	out, err := io.ReadAll(io.LimitReader(r, 16<<20))
	if err != nil {
		return nil
	}
	return out
}

// profileSpace is the colour space an ICC profile describes, such as "RGB " or "GRAY".
func profileSpace(profile []byte) string {
	if len(profile) < 128 {
		return ""
	}
	return string(profile[16:20])
}

// exifOrientation reads tag 0x0112 from a TIFF-structured EXIF block; 0 when absent.
func exifOrientation(t []byte) int {
	if len(t) < 8 {
		return 0
	}
	var bo binary.ByteOrder = binary.BigEndian
	if string(t[:2]) == "II" {
		bo = binary.LittleEndian
	}
	off := int(bo.Uint32(t[4:]))
	if off < 8 || off+2 > len(t) {
		return 0
	}
	for i := range int(bo.Uint16(t[off:])) {
		e := off + 2 + i*12
		if e+12 > len(t) {
			return 0
		}
		if bo.Uint16(t[e:]) == 0x0112 {
			if o := int(bo.Uint16(t[e+8:])); o >= 1 && o <= 8 {
				return o
			}
			return 0
		}
	}
	return 0
}

// withJPEGProfile embeds an ICC profile right after the SOI marker, split into APP2 segments.
func withJPEGProfile(jpg, profile []byte) []byte {
	if len(profile) == 0 {
		return jpg
	}
	const room = 65535 - 2 - 14
	count := (len(profile) + room - 1) / room
	var b bytes.Buffer
	b.Grow(len(jpg) + len(profile) + count*18)
	b.Write(jpg[:2])
	for i := range count {
		part := profile[i*room : min(len(profile), (i+1)*room)]
		b.Write([]byte{0xFF, 0xE2, byte((16 + len(part)) >> 8), byte(16 + len(part))})
		b.WriteString("ICC_PROFILE\x00")
		b.Write([]byte{byte(i + 1), byte(count)})
		b.Write(part)
	}
	b.Write(jpg[2:])
	return b.Bytes()
}

// withPNGChunks inserts ancillary chunks right after IHDR, where colour chunks belong.
func withPNGChunks(png []byte, chunks [][]byte) []byte {
	const ihdrEnd = 8 + 12 + 13
	if len(chunks) == 0 || len(png) < ihdrEnd {
		return png
	}
	var b bytes.Buffer
	b.Write(png[:ihdrEnd])
	for _, c := range chunks {
		b.Write(c)
	}
	b.Write(png[ihdrEnd:])
	return b.Bytes()
}

func iccpChunk(profile []byte) []byte {
	var body bytes.Buffer
	body.WriteString("ICC Profile\x00\x00")
	z := zlib.NewWriter(&body)
	z.Write(profile)
	z.Close()
	return pngChunk("iCCP", body.Bytes())
}

func pngChunk(typ string, body []byte) []byte {
	c := make([]byte, 12+len(body))
	binary.BigEndian.PutUint32(c, uint32(len(body)))
	copy(c[4:], typ)
	copy(c[8:], body)
	binary.BigEndian.PutUint32(c[8+len(body):], crc32.ChecksumIEEE(c[4:8+len(body)]))
	return c
}
