import { createRootRoute, Link, Outlet, retainSearchParams, useRouterState } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { NavigationMenu, NavigationMenuItem, NavigationMenuList } from '@/components/ui/navigation-menu'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/useTheme'
import { Sun, Moon, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import LogoLight from '@/assets/logo/sparkping_logo.svg'
import LogoDark from '@/assets/logo/sparkping_logo_dark.svg'
import { type TimeRangeSearchParams, validateTimeRangeSearch } from '@/utils/timeRangeUtils'

export const Route = createRootRoute({
  validateSearch: (search: Record<string, unknown>): TimeRangeSearchParams => {
    return validateTimeRangeSearch(search);
  },
  search: {
    middlewares: [retainSearchParams(['preset', 'from', 'to', 'bucket', 'refresh', 'interval'])],
  },
  component: RootComponent,
})

function RootComponent() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navigation />
      <main>
        <Outlet />
      </main>
      {import.meta.env.DEV && <TanStackRouterDevtools />}
    </div>
  )
}

function Navigation() {
  const router = useRouterState()
  const currentPath = router.location.pathname
  const { theme, setTheme, isDark } = useTheme()

  const themeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor
  const ThemeIcon = themeIcon

  const cycleTheme = () => {
    const nextTheme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    setTheme(nextTheme);
  };

  return (
    <nav className="border-b border-border bg-card">
      <div className="container mx-auto px-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 py-0">
            <img
              src={isDark ? LogoDark : LogoLight}
              alt="SparkPing"
              className="size-16"
            />
            <span className="text-lg font-bold">
              <span className="text-[#F2455C]">Spark</span>
              <span className="text-foreground">Ping</span>
            </span>
          </Link>

          {/* Navigation Links */}
          <NavigationMenu>
            <NavigationMenuList className="gap-2">
              <NavigationMenuItem>
                <Link
                  to="/"
                  className={cn(
                    'group inline-flex h-10 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50',
                    currentPath === '/' && 'bg-accent'
                  )}
                >
                  Dashboard
                </Link>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <Link
                  to="/settings"
                  className={cn(
                    'group inline-flex h-10 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50',
                    currentPath === '/settings' && 'bg-accent'
                  )}
                >
                  Settings
                </Link>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={cycleTheme}
          className="text-muted-foreground hover:text-foreground"
          title={`Theme: ${theme}`}
        >
          <ThemeIcon className="size-5" />
        </Button>
      </div>
    </nav>
  )
}

