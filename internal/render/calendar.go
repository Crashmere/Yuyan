package render

import (
	"encoding/json"
	"html"

	"github.com/Crashmere/Yuyan/internal/doc"
)

func (r *renderer) calendar(n doc.Node) {
	c, _ := doc.CalendarData(n)
	data, _ := json.Marshal(c)
	r.open("section", [][2]string{{"data-calendar", "1"}, {"data-calendar-content", string(data)}, {"class", "yy-calendar-block"}})
	r.b.WriteString("<strong>" + html.EscapeString(c.Title) + "</strong><table><thead><tr><th>状态</th><th>起始</th><th>结束</th><th>标注</th></tr></thead><tbody>")
	for _, p := range c.Periods {
		r.b.WriteString("<tr>")
		for _, value := range []string{p.Title, p.StartDate, p.EndDate, p.Note} {
			r.b.WriteString("<td>" + html.EscapeString(value) + "</td>")
		}
		r.b.WriteString("</tr>")
	}
	r.b.WriteString("</tbody></table></section>")
}
