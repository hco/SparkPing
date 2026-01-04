import { format } from 'date-fns';
import { X, Check, ZoomIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ZoomControlsProps {
  zoomedDomain: [number, number];
  onReset: () => void;
  onApply?: () => void;
}

export function ZoomControls({ zoomedDomain, onReset, onApply }: ZoomControlsProps) {
  const [from, to] = zoomedDomain;
  const fromDate = new Date(from);
  const toDate = new Date(to);

  const formatRange = () => {
    const sameDay = fromDate.toDateString() === toDate.toDateString();
    if (sameDay) {
      return `${format(fromDate, 'MMM d, HH:mm')} – ${format(toDate, 'HH:mm')}`;
    }
    return `${format(fromDate, 'MMM d, HH:mm')} – ${format(toDate, 'MMM d, HH:mm')}`;
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 text-sm">
      <ZoomIn className="h-4 w-4 text-blue-500 shrink-0" />
      <span className="text-muted-foreground">Zoomed:</span>
      <span className="font-medium text-foreground">{formatRange()}</span>

      <div className="flex items-center gap-1 ml-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground hover:text-foreground"
              onClick={onReset}
            >
              <X className="h-4 w-4 mr-1" />
              Reset
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reset zoom to show full time range</TooltipContent>
        </Tooltip>

        {onApply && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size="sm"
                className="h-7 px-2 bg-blue-600 hover:bg-blue-700"
                onClick={onApply}
              >
                <Check className="h-4 w-4 mr-1" />
                Apply
              </Button>
            </TooltipTrigger>
            <TooltipContent>Set this as the time range filter</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
