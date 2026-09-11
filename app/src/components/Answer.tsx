import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * A provider's answer, rendered as the Markdown the models actually emit.
 *
 * Every backend here returns Markdown — headings, bold, bullets, fenced code —
 * and the chat used to print it raw, so answers arrived full of visible hashes
 * and asterisks.
 *
 * The content is written by whichever provider claimed the job, which is not
 * someone this app trusts. Raw HTML is therefore never enabled: `react-markdown`
 * ignores it unless `rehype-raw` is added, and it is not. `urlTransform` narrows
 * links further to the two schemes an answer has any business linking with, so a
 * crafted `javascript:` or `data:` link cannot ride in on an answer.
 */
const SAFE_SCHEME = /^(https?:)/i;

function safeUrl(url: string): string {
  const trimmed = url.trim();
  // Relative and anchor links resolve against this app, which is harmless.
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  return SAFE_SCHEME.test(trimmed) ? trimmed : "";
}

export function Answer({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={safeUrl}
        components={{
          // Every answer opens at the same level as the surrounding chat, so a
          // model that starts at `#` does not out-shout the page around it.
          h1: ({ children }) => <h3 className="md-h1">{children}</h3>,
          h2: ({ children }) => <h4 className="md-h2">{children}</h4>,
          h3: ({ children }) => <h5 className="md-h3">{children}</h5>,
          h4: ({ children }) => <h6 className="md-h3">{children}</h6>,
          h5: ({ children }) => <h6 className="md-h3">{children}</h6>,
          h6: ({ children }) => <h6 className="md-h3">{children}</h6>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer nofollow ugc">
              {children}
            </a>
          ),
          // Tables can exceed the thread; they scroll rather than widen it.
          table: ({ children }) => (
            <div className="md-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
