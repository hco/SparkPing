import { createRootRoute, Link, Outlet, useRouterState } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { NavigationMenu, NavigationMenuItem, NavigationMenuList } from '@/components/ui/navigation-menu'
import { cn } from '@/lib/utils'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <div className="min-h-screen bg-gray-100">
      <Navigation />
      <main>
        <Outlet />
      </main>
      <TanStackRouterDevtools />
    </div>
  )
}

function Navigation() {
  const router = useRouterState()
  const currentPath = router.location.pathname

  return (
    <nav className="border-b bg-white">
      <div className="container mx-auto px-4">
        <NavigationMenu>
          <NavigationMenuList className="gap-6">
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
    </nav>
  )
}

