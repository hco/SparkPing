import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export const BUCKET_DURATION_OPTIONS = [
  { value: '1s', label: '1 second' },
  { value: '5s', label: '5 seconds' },
  { value: '10s', label: '10 seconds' },
  { value: '30s', label: '30 seconds' },
  { value: '1m', label: '1 minute' },
  { value: '5m', label: '5 minutes' },
  { value: '15m', label: '15 minutes' },
  { value: '1h', label: '1 hour' },
] as const;

export type BucketDuration = (typeof BUCKET_DURATION_OPTIONS)[number]['value'];

interface DurationPickerProps {
  /** Current duration value */
  value: string;
  /** Callback when duration changes */
  onChange: (value: string) => void;
  /** Label text displayed before the picker */
  label?: string;
  /** ID for the select element (for label association) */
  id?: string;
  /** Width of the select trigger */
  triggerWidth?: string;
  /** Additional className for the container */
  className?: string;
}

export function DurationPicker({
  value,
  onChange,
  label = 'Duration',
  id = 'duration-picker',
  triggerWidth = 'w-20',
  className,
}: DurationPickerProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg border bg-card/50 backdrop-blur-sm shadow-sm',
        className
      )}
    >
      <Label htmlFor={id} className="text-sm text-muted-foreground whitespace-nowrap">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className={cn(triggerWidth, 'h-8')}>
          <SelectValue>{value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {BUCKET_DURATION_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
