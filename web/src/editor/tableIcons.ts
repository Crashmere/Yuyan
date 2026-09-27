import { defineComponent, h } from 'vue'

// Icons for inserting table rows and columns: the table, with a plus on the side where the new row
// or column goes. Drawn like the lucide icons around them.
function icon(paths: string[]) {
  return defineComponent({
    props: { size: { type: [Number, String], default: 24 } },
    setup: (props) => () =>
      h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          width: props.size,
          height: props.size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 2,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'aria-hidden': 'true',
        },
        paths.map((d) => h('path', { d })),
      ),
  })
}

export const RowAbove = icon(['M5 11h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z', 'M3 16h18', 'M12 2.5v5', 'M9.5 5h5'])
export const RowBelow = icon(['M5 3h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M3 8h18', 'M12 16.5v5', 'M9.5 19h5'])
export const ColumnLeft = icon(['M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M16 3v18', 'M5 9.5v5', 'M2.5 12h5'])
export const ColumnRight = icon(['M5 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M8 3v18', 'M19 9.5v5', 'M16.5 12h5'])
