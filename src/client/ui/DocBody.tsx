import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import guide from '../docs/guide.md?raw'
import spec from '../docs/spec.md?raw'
import guideEn from '../docs/guide.en.md?raw'
import specEn from '../docs/spec.en.md?raw'
import guideVi from '../docs/guide.vi.md?raw'
import specVi from '../docs/spec.vi.md?raw'
import { getLang } from '../lang'

export default function DocBody({ which }: { which: 'guide' | 'spec' }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
        table: ({ children }) => (
          <div className="doc-table">
            <table>{children}</table>
          </div>
        ),
      }}
    >
      {{ zh: { guide, spec }, en: { guide: guideEn, spec: specEn }, vi: { guide: guideVi, spec: specVi } }[getLang()][which]}
    </Markdown>
  )
}
