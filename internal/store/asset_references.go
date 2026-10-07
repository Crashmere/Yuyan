package store

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"regexp"
	"strings"

	"github.com/Crashmere/Yuyan/internal/doc"
)

var ErrMissingAsset = errors.New("附件已清理或不存在，请重新上传后保存")

var mediaPath = regexp.MustCompile(`/(?:assets/([0-9a-f]{32})\.(?:png|jpg|gif|webp|bmp|bin)|attachments/([0-9a-f]{32})(?:/content)?|drawings/([0-9a-f]{32})(?:/(?:preview|file))?)$`)

// Include nested blocks, image boards and links to media. Conservatively retain
// matching absolute URLs too; only local image/attachment node sources are required
// to exist when saving (external links need not belong to this instance).
func mediaReferences(n doc.Node) map[string]bool {
	refs := map[string]bool{}
	var attrs func(map[string]any, bool)
	attrs = func(values map[string]any, required bool) {
		for key, value := range values {
			raw, ok := value.(string)
			if !ok {
				continue
			}
			u, err := url.Parse(raw)
			if err != nil {
				continue
			}
			match := mediaPath.FindStringSubmatch(u.Path)
			if match == nil {
				continue
			}
			id := match[1] + match[2] + match[3]
			local := strings.HasPrefix(raw, "/assets/") || strings.HasPrefix(raw, "/attachments/") || strings.HasPrefix(raw, "/drawings/")
			refs[id] = refs[id] || (required && key == "src" && local)
		}
	}
	var walk func(doc.Node)
	walk = func(n doc.Node) {
		attrs(n.Attrs, n.Type == "image" || n.Type == "attachment" || n.Type == "drawing")
		for _, mark := range n.Marks {
			attrs(mark.Attrs, false)
		}
		for _, child := range n.Content {
			walk(child)
		}
	}
	walk(n)
	return refs
}

// Run in the same transaction as the content write. Reuse cancels a pending
// countdown even when the reference is added and removed between two scans.
func (s *Store) retainContentAssets(ctx context.Context, tx *sql.Tx, n doc.Node) error {
	if err := s.validateDrawings(ctx, tx, n); err != nil {
		return err
	}
	for id, required := range mediaReferences(n) {
		if err := retainAsset(ctx, tx, id, required); err != nil {
			return err
		}
		if err := s.retainDrawingAsset(ctx, tx, id); err != nil {
			return err
		}
	}
	return nil
}

func retainAsset(ctx context.Context, tx *sql.Tx, id string, required bool) error {
	var exists, deleting bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM assets WHERE id = ?), EXISTS(SELECT 1 FROM meta WHERE key GLOB ? AND json_extract(value, '$.deleting') = 1)`, id, assetGCKey+id+".*").Scan(&exists, &deleting); err != nil {
		return err
	}
	if (required && !exists) || deleting {
		return ErrMissingAsset
	}
	_, err := tx.ExecContext(ctx, `DELETE FROM meta WHERE key GLOB ?`, assetGCKey+id+".*")
	return err
}
