import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { fetchTargets, createTarget, updateTarget, deleteTarget } from '@/api'
import type { Target, TargetRequest } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Trash2, Edit2, Plus, X, Save } from 'lucide-react'

export const Route = createFileRoute('/settings')({
  component: Settings,
})

function Settings() {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [formData, setFormData] = useState<TargetRequest>({
    address: '',
    name: '',
    ping_count: 3,
    ping_interval: 1,
  })

  const { data: targets, isLoading, error } = useQuery({
    queryKey: ['targets'],
    queryFn: fetchTargets,
  })

  const createMutation = useMutation({
    mutationFn: createTarget,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['targets'] })
      setShowAddForm(false)
      setFormData({ address: '', name: '', ping_count: 3, ping_interval: 1 })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, target }: { id: string; target: TargetRequest }) => updateTarget(id, target),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['targets'] })
      setEditingId(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteTarget,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['targets'] })
    },
  })

  const handleEdit = (target: Target) => {
    setEditingId(target.id)
    setFormData({
      id: target.id,
      address: target.address,
      name: target.name || '',
      ping_count: target.ping_count,
      ping_interval: target.ping_interval,
    })
    setShowAddForm(false)
  }

  const handleCancel = () => {
    setEditingId(null)
    setShowAddForm(false)
    setFormData({ address: '', name: '', ping_count: 3, ping_interval: 1 })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editingId) {
      updateMutation.mutate({ id: editingId, target: formData })
    } else {
      createMutation.mutate(formData)
    }
  }

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this target?')) {
      deleteMutation.mutate(id)
    }
  }

  return (
    <div className="min-h-screen bg-background w-screen">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Settings</h1>
          <p className="text-muted-foreground">Manage your ping targets</p>
        </header>

        {error && (
          <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded mb-4">
            Error loading targets: {error instanceof Error ? error.message : 'Unknown error'}
          </div>
        )}

        <div className="bg-card rounded-lg shadow border border-border p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-foreground">Targets</h2>
            {!showAddForm && !editingId && (
              <Button onClick={() => setShowAddForm(true)}>
                <Plus className="size-4" />
                Add Target
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="text-muted-foreground">Loading targets...</div>
          ) : targets && targets.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center">
              No targets configured. Add your first target to get started.
            </div>
          ) : (
            <div className="space-y-4">
              {targets?.map((target) => (
                <div key={target.id} className="border border-border rounded-lg p-4">
                  {editingId === target.id ? (
                    <TargetForm
                      formData={formData}
                      setFormData={setFormData}
                      onSubmit={handleSubmit}
                      onCancel={handleCancel}
                      isSubmitting={updateMutation.isPending}
                    />
                  ) : (
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-foreground">
                            {target.name || target.address}
                          </h3>
                          <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                            ID: {target.id}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground space-y-1">
                          <div>
                            <span className="font-medium text-foreground">Address:</span> {target.address}
                          </div>
                          {target.name && (
                            <div>
                              <span className="font-medium text-foreground">Name:</span> {target.name}
                            </div>
                          )}
                          <div>
                            <span className="font-medium text-foreground">Ping Count:</span> {target.ping_count}
                            {target.ping_count === 3 && (
                              <span className="opacity-60 ml-1">(default)</span>
                            )}
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Ping Interval:</span> {target.ping_interval}s
                            {target.ping_interval === 1 && (
                              <span className="opacity-60 ml-1">(default)</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(target)}
                        >
                          <Edit2 className="size-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(target.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {showAddForm && (
            <div className="mt-6 border-t border-border pt-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">Add New Target</h3>
              <TargetForm
                formData={formData}
                setFormData={setFormData}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                isSubmitting={createMutation.isPending}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface TargetFormProps {
  formData: TargetRequest
  setFormData: (data: TargetRequest) => void
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
  isSubmitting: boolean
}

function TargetForm({ formData, setFormData, onSubmit, onCancel, isSubmitting }: TargetFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="address">
            Address <span className="text-destructive">*</span>
          </Label>
          <Input
            id="address"
            type="text"
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            placeholder="192.168.1.1"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="name">Name (optional)</Label>
          <Input
            id="name"
            type="text"
            value={formData.name || ''}
            onChange={(e) => setFormData({ ...formData, name: e.target.value || undefined })}
            placeholder="My Server"
          />
          <p className="text-xs text-muted-foreground">Display name for this target</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ping_count">
            Ping Count (optional)
          </Label>
          <Input
            id="ping_count"
            type="number"
            min="1"
            value={formData.ping_count || ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                ping_count: e.target.value ? parseInt(e.target.value, 10) : undefined,
              })
            }
            placeholder="3"
          />
          <p className="text-xs text-muted-foreground">Number of pings per cycle (default: 3)</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ping_interval">
            Ping Interval (optional)
          </Label>
          <Input
            id="ping_interval"
            type="number"
            min="1"
            value={formData.ping_interval || ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                ping_interval: e.target.value ? parseInt(e.target.value, 10) : undefined,
              })
            }
            placeholder="1"
          />
          <p className="text-xs text-muted-foreground">Seconds between ping cycles (default: 1)</p>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={isSubmitting}>
          <Save className="size-4" />
          {isSubmitting ? 'Saving...' : 'Save'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          <X className="size-4" />
          Cancel
        </Button>
      </div>
    </form>
  )
}
