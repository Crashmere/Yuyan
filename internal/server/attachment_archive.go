package server

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/bzip2"
	"compress/gzip"
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"strings"
	"unicode/utf8"

	"github.com/bodgit/sevenzip"
	"github.com/nwaples/rardecode/v2"
	"github.com/ulikunitz/xz"
)

const archiveEntryLimit = 5000
const archiveReadLimit = 64 << 20

var errArchiveLimit = errors.New("archive preview limit")

type archiveEntry struct {
	Path string `json:"path"`
	Size uint64 `json:"size"`
	Dir  bool   `json:"dir,omitempty"`
}

func archiveFormat(header []byte, name string) string {
	name = strings.ToLower(name)
	// Office packages are ZIP internally, but are not archive attachments.
	for _, ext := range []string{".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp"} {
		if strings.HasSuffix(name, ext) {
			return ""
		}
	}
	switch {
	case bytes.HasPrefix(header, []byte("PK\x03\x04")), bytes.HasPrefix(header, []byte("PK\x05\x06")), strings.HasSuffix(name, ".zip"):
		return "zip"
	case bytes.HasPrefix(header, []byte("7z\xbc\xaf\x27\x1c")), strings.HasSuffix(name, ".7z"):
		return "7z"
	case bytes.HasPrefix(header, []byte("Rar!\x1a\x07")), strings.HasSuffix(name, ".rar"):
		return "rar"
	case bytes.HasPrefix(header, []byte{0x1f, 0x8b}), strings.HasSuffix(name, ".gz"), strings.HasSuffix(name, ".tgz"):
		if strings.HasSuffix(name, ".tar.gz") || strings.HasSuffix(name, ".tgz") {
			return "tar.gz"
		}
		return "gz"
	case strings.HasSuffix(name, ".tar.bz2"), strings.HasSuffix(name, ".tbz2"):
		return "tar.bz2"
	case strings.HasSuffix(name, ".tar.xz"), strings.HasSuffix(name, ".txz"):
		return "tar.xz"
	case strings.HasSuffix(name, ".tar"), len(header) >= 262 && string(header[257:262]) == "ustar":
		return "tar"
	}
	return ""
}

// Check cancellation on archive reads, including the random reads used by ZIP/7z.
type archiveInput struct {
	*os.File
	ctx context.Context
}

func (f archiveInput) Read(p []byte) (int, error) {
	if err := f.ctx.Err(); err != nil {
		return 0, err
	}
	return f.File.Read(p)
}
func (f archiveInput) ReadAt(p []byte, off int64) (int, error) {
	if err := f.ctx.Err(); err != nil {
		return 0, err
	}
	return f.File.ReadAt(p, off)
}

// RAR's listing API accepts an fs.FS. Expose only this file, never neighbouring assets/volumes.
type archiveFS struct {
	file *os.File
	ctx  context.Context
}

func (f archiveFS) Open(name string) (fs.File, error) {
	if name != "archive" {
		return nil, fs.ErrNotExist
	}
	file, err := os.Open(f.file.Name())
	if err != nil {
		return nil, err
	}
	return archiveInput{file, f.ctx}, nil
}

type archiveBudget struct {
	source io.Reader
	left   int64
	ctx    context.Context
}

func (r *archiveBudget) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	if r.left <= 0 {
		return 0, errArchiveLimit
	}
	if int64(len(p)) > r.left {
		p = p[:r.left]
	}
	n, err := r.source.Read(p)
	r.left -= int64(n)
	return n, err
}

func previewArchive(ctx context.Context, file *os.File, size int64, format string) attachmentPreview {
	result := attachmentPreview{Kind: "archive", Entries: []archiveEntry{}}
	nameBytes := 0
	add := func(name string, size uint64, dir bool) bool {
		nameBytes += len(name)
		if len(result.Entries) >= archiveEntryLimit || len(name) > 4096 || nameBytes > 1<<20 {
			result.Truncated = true
			return false
		}
		// Names remain inert text, including absolute paths and ../ components. No extraction.
		if !utf8.ValidString(name) {
			name = strings.ToValidUTF8(name, "�")
		}
		result.Entries = append(result.Entries, archiveEntry{name, size, dir})
		return true
	}
	input := archiveInput{file, ctx}
	var err error
	switch format {
	case "zip":
		var reader *zip.Reader
		reader, err = zip.NewReader(input, size)
		if err == nil || errors.Is(err, zip.ErrInsecurePath) {
			err = nil
			for _, entry := range reader.File {
				if !add(entry.Name, entry.UncompressedSize64, entry.FileInfo().IsDir()) {
					break
				}
			}
		}
	case "7z":
		var reader *sevenzip.Reader
		reader, err = sevenzip.NewReader(input, size)
		if err == nil {
			for _, entry := range reader.File {
				if !add(entry.Name, entry.UncompressedSize, entry.FileInfo().IsDir()) {
					break
				}
			}
		}
	case "rar":
		var entries []*rardecode.File
		entries, err = rardecode.List("archive", rardecode.FileSystem(archiveFS{file, ctx}), rardecode.MaxDictionarySize(archiveReadLimit))
		if err == nil {
			for _, entry := range entries {
				if !add(entry.Name, uint64(max(entry.UnPackedSize, 0)), entry.IsDir) {
					break
				}
			}
		}
	default:
		var source io.Reader = input
		switch format {
		case "gz", "tar.gz":
			var reader *gzip.Reader
			reader, err = gzip.NewReader(input)
			if err == nil {
				defer reader.Close()
				source = reader
				if format == "gz" {
					name := reader.Name
					if name == "" {
						name = "压缩内容"
					}
					var n int64
					n, err = io.Copy(io.Discard, &archiveBudget{source, archiveReadLimit, ctx})
					add(name, uint64(n), false)
				}
			}
		case "tar.bz2":
			source = bzip2.NewReader(input)
		case "tar.xz":
			source, err = (xz.ReaderConfig{DictCap: archiveReadLimit}).NewReader(input)
		}
		if err == nil && format != "gz" {
			reader := tar.NewReader(&archiveBudget{source, archiveReadLimit, ctx})
			for {
				var entry *tar.Header
				entry, err = reader.Next()
				if err == io.EOF {
					err = nil
					break
				}
				if err != nil {
					break
				}
				if !add(entry.Name, uint64(max(entry.Size, 0)), entry.FileInfo().IsDir()) {
					break
				}
			}
		}
	}
	if errors.Is(err, errArchiveLimit) || errors.Is(err, context.DeadlineExceeded) {
		result.Truncated = true
	} else if err != nil {
		result.Message = "无法读取完整目录，压缩包可能已加密、损坏，或需要其他分卷。可下载后打开。"
	}
	if result.Truncated {
		result.Message = "压缩包较大，仅展示已读取的目录（最多 5,000 项）；完整内容请下载查看。"
	}
	return result
}
