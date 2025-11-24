import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  component: Settings,
})

function Settings() {
  return (
    <div className="min-h-screen bg-gray-100 w-screen">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Settings</h1>
          <p className="text-gray-600">Configure your SparkPing preferences</p>
        </header>

        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-gray-600">Settings page coming soon...</p>
        </div>
      </div>
    </div>
  )
}

