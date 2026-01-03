import { useState, useCallback, useEffect, type JSX } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { Fragment } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { codeToHast } from 'shiki/bundle/web';

interface JsonViewProps {
  data: unknown;
  className?: string;
}

async function highlightJson(code: string, isDark: boolean): Promise<JSX.Element> {
  const hast = await codeToHast(code, {
    lang: 'json',
    theme: isDark ? 'github-dark-default' : 'github-light-default',
  });

  return toJsxRuntime(hast, {
    Fragment,
    jsx,
    jsxs,
  }) as JSX.Element;
}

export function JsonView({ data, className = '' }: JsonViewProps) {
  const { isDark } = useTheme();
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState<JSX.Element | null>(null);
  const jsonString = JSON.stringify(data, null, 2);

  useEffect(() => {
    let cancelled = false;
    
    highlightJson(jsonString, isDark).then((result) => {
      if (!cancelled) {
        setHighlighted(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [jsonString, isDark]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  }, [jsonString]);

  return (
    <div className={`relative group ${className}`}>
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy to clipboard'}
      >
        {copied ? (
          <Check className="size-4 text-green-500" />
        ) : (
          <Copy className="size-4" />
        )}
      </Button>
      <div className="text-xs overflow-x-auto rounded [&_pre]:!bg-muted/50 [&_pre]:p-3 [&_pre]:m-0 [&_pre]:rounded [&_code]:break-words [&_code]:whitespace-pre-wrap">
        {highlighted ?? (
          <pre className="bg-muted/50 p-3 rounded">
            <code className="whitespace-pre-wrap break-words">{jsonString}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
