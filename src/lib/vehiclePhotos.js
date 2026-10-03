// ============================================================================
// VEHICLE PHOTOS — thumbnails for the fleet card grid.
//
// A vehicle's photo is the vehicle_documents row with doc_type='Photo' (same
// store the profile header uses, see VehiclePhotoSection). Serving it needs a
// presigned R2 URL from fleet-presign-download, one call per photo, so this
// helper resolves a whole list at once and caches the URLs for the page's
// lifetime (presigned links expire, so the cache is short and in-memory only).
//
//   const urls = await loadVehiclePhotoUrls(vehicles.map(v => v.id))
//   urls[vehicleId] → downloadUrl | undefined
// ============================================================================

import { supabase } from './supabase'
import { auth } from './firebase'
import { adminFnHeaders } from './fnAuth'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const TTL_MS = 10 * 60 * 1000

const cache = new Map()   // vehicleId → { url, at }

export async function loadVehiclePhotoUrls(vehicleIds) {
  const out = {}
  const need = []
  const now = Date.now()
  for (const id of vehicleIds || []) {
    const c = cache.get(id)
    if (c && now - c.at < TTL_MS) out[id] = c.url
    else need.push(id)
  }
  if (need.length === 0) return out

  const { data, error } = await supabase
    .from('vehicle_documents')
    .select('id, vehicle_id')
    .eq('doc_type', 'Photo')
    .is('deleted_at', null)
    .in('vehicle_id', need)
  if (error) throw error
  if (!data || data.length === 0) return out

  // Signed out (or a harness without Firebase) → no presign; cards show the
  // placeholder instead of erroring.
  let headers
  try { headers = await adminFnHeaders() } catch { return out }
  const requestedByEmail = auth.currentUser?.email || ''

  await Promise.all(data.map(async d => {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/fleet-presign-download`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ownerType: 'vehicle', documentId: d.id, requestedByEmail }),
      })
      const j = await resp.json().catch(() => ({}))
      if (resp.ok && j.downloadUrl) {
        out[d.vehicle_id] = j.downloadUrl
        cache.set(d.vehicle_id, { url: j.downloadUrl, at: Date.now() })
      }
    } catch { /* one missing thumbnail must not break the grid */ }
  }))
  return out
}

// Call after a photo is replaced/removed on the profile so the grid refreshes.
export function forgetVehiclePhoto(vehicleId) {
  cache.delete(vehicleId)
}
