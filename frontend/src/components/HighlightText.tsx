function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function HighlightText({ text, keyword }: { text: string; keyword: string }) {
  if (!keyword || !text) return <>{text}</>
  const escaped = escapeRegex(keyword)
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === keyword.toLowerCase() ? (
          <mark key={i} className="bg-amber-200 text-amber-900 rounded px-0.5">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  )
}
