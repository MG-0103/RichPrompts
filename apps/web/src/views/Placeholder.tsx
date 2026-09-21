import { Construction } from 'lucide-react'

interface Props {
  title: string
  note?: string
}

export function Placeholder({ title, note }: Props) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Construction className="h-6 w-6" />
        </div>
        <h2 className="mb-2 text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">
          {note ?? 'This view is not migrated yet. It will land in a later step.'}
        </p>
      </div>
    </div>
  )
}
