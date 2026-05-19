import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '../App'
import { useToast } from './Toast'
import { supabaseAdmin } from '../lib/supabase'
import { uploadFleetDocument, softDeleteFleetDocument, formatBytes } from '../lib/fleetDocuments'

// ============================================================================
// VEHICLE PHOTO  (header thumbnail)
//
// Compact ~190px image that sits next to the RC number in the vehicle
// profile header. Click to add/replace; small Remove link below.
//
// The photo is stored as a vehicle_documents row with doc_type='Photo', so it
// reuses the whole upload pipeline. Requires the Phase 7 SQL + the 'Photo'
// entry in fleet-confirm-upload's allowed set.
//
// Props: vehicle  (needs .id, .rc_number)
// ============================================================================

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ADMIN_SECRET = import.meta.env.VITE_HRMS_ADMIN_SECRET
const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY

const ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.heif'
const MAX_BYTES = 10 * 1024 * 1024

const W = 190   // thumbnail width
const H = 128   // thumbnail height

export default function VehiclePhotoSection({ vehicle }) {
  const { user } = useAuth()
  const toast = useToast()
  const fileRef = useRef(null)

  const [photoDoc, setPhotoDoc] = useState(null)
  const [imageUrl, setImageUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  async function load() {
    setLoading(true)
    try {
      const { data, error } = await supabaseAdmin
        .from('vehicle_documents')
        .select('*')
        .eq('vehicle_id', vehicle.id)
        .eq('doc_type', 'Photo')
        .is('deleted_at', null)
        .maybeSingle()
      if (error) throw error
      setPhotoDoc(data || null)
      setImageUrl(data ? await fetchUrl(data.id) : null)
    } catch (e) {
      toast.show('Failed to load vehicle photo: ' + e.message, 'error')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [vehicle.id])

  async function fetchUrl(docId) {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/fleet-presign-download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': ADMIN_SECRET,
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({ ownerType: 'vehicle', documentId: docId, requestedByEmail: user.email }),
    })
    const j = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(j.detail || j.error || 'could not get image URL')
    return j.downloadUrl
  }

  function pickFile() {
    if (!uploading) fileRef.current?.click()
  }

  async function handleFile(file) {
    if (!file) return
    if (file.size > MAX_BYTES) {
      toast.show(`Image too large (max ${formatBytes(MAX_BYTES)})`, 'error')
      return
    }
    if (!file.type.startsWith('image/')) {
      toast.show('Please choose an image file', 'error')
      return
    }
    setUploading(true)
    setProgress(0)
    try {
      await uploadFleetDocument({
        ownerType: 'vehicle',
        ownerId: vehicle.id,
        file,
        docType: 'Photo',
        displayName: file.name,
        uploadedByEmail: user.email,
        replaceExistingId: photoDoc ? photoDoc.id : null,
        onProgress: setProgress,
      })
      toast.show(photoDoc ? 'Vehicle photo replaced' : 'Vehicle photo added')
      await load()
    } catch (e) {
      toast.show('Upload failed: ' + e.message, 'error')
    }
    setUploading(false)
    setProgress(0)
  }

  async function handleRemove() {
    if (!photoDoc) return
    try {
      await softDeleteFleetDocument({
        ownerType: 'vehicle',
        documentId: photoDoc.id,
        deletedByEmail: user.email,
      })
      toast.show('Vehicle photo removed')
      await load()
    } catch (e) {
      toast.show('Remove failed: ' + e.message, 'error')
    }
  }

  return (
    <div style={{ flex: '0 0 auto' }}>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        style={{ display: 'none' }}
        onChange={e => handleFile(e.target.files?.[0])}
      />

      {/* Thumbnail */}
      <div
        onClick={imageUrl ? undefined : pickFile}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]) }}
        style={{
          width: W, height: H,
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          background: 'var(--gray-100)',
          border: imageUrl ? '1px solid var(--gray-200)' : '1.5px dashed var(--gray-200)',
          cursor: uploading ? 'default' : (imageUrl ? 'default' : 'pointer'),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}
      >
        {loading ? (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading…</span>
        ) : uploading ? (
          <div style={{ textAlign: 'center', padding: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
              Uploading… {Math.round(progress * 100)}%
            </div>
            <div style={{ height: 4, width: 120, background: 'var(--gray-200)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress * 100}%`, background: 'var(--green-dark)', transition: 'width 0.2s' }} />
            </div>
          </div>
        ) : imageUrl ? (
          <img
            src={imageUrl}
            alt={`Vehicle ${vehicle.rc_number || ''}`}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{ textAlign: 'center', padding: 12 }}>
            <div style={{ fontSize: 22, lineHeight: 1, marginBottom: 4 }}>📷</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 500 }}>
              Add vehicle photo
            </div>
            <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 2 }}>
              click or drop an image
            </div>
          </div>
        )}
      </div>

      {/* Manage links — only when a photo exists */}
      {imageUrl && !uploading && (
        <div style={{ display: 'flex', gap: 10, marginTop: 6, justifyContent: 'center' }}>
          <button onClick={pickFile} style={linkBtn}>Replace</button>
          <span style={{ color: 'var(--gray-200)' }}>·</span>
          <button onClick={handleRemove} style={{ ...linkBtn, color: 'var(--crimson)' }}>Remove</button>
        </div>
      )}
    </div>
  )
}

const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  fontSize: 11, fontWeight: 500, color: 'var(--green-dark)', fontFamily: 'inherit',
}
