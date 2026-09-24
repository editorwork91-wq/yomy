export type QueuedMessage = {
  clientMessageId: string
  userId: string
  otherUserId: string
  content: string
  replyToId: string | null
  createdAt: string
}

const DB_NAME = 'yomy-offline-v4'
const DB_VERSION = 2
const KV_STORE = 'kv'
const QUEUE_STORE = 'queue'

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE)
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: 'clientMessageId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

async function putValue<T>(key: string, value: T) {
  const db = await openDb()
  if (!db) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
    return
  }
  await new Promise<void>(resolve => {
    const tx = db.transaction(KV_STORE, 'readwrite')
    tx.objectStore(KV_STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  db.close()
}

async function getValue<T>(key: string): Promise<T | null> {
  const db = await openDb()
  if (!db) {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) as T : null
    } catch { return null }
  }
  return await new Promise<T | null>(resolve => {
    const tx = db.transaction(KV_STORE, 'readonly')
    const request = tx.objectStore(KV_STORE).get(key)
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null)
    request.onerror = () => resolve(null)
  }).finally(() => db.close())
}

export async function cacheJson<T>(key: string, value: T) {
  await putValue(key, value)
}

export async function readCachedJson<T>(key: string) {
  return getValue<T>(key)
}

export async function cacheMessages(userId: string, otherUserId: string, messages: unknown[]) {
  await cacheJson(`messages:${userId}:${otherUserId}`, messages)
}

export async function readCachedMessages<T>(userId: string, otherUserId: string) {
  return readCachedJson<T[]>(`messages:${userId}:${otherUserId}`)
}

export async function cacheConversations(userId: string, conversations: unknown[]) {
  await cacheJson(`conversations:${userId}`, conversations)
}

export async function readCachedConversations<T>(userId: string) {
  return readCachedJson<T[]>(`conversations:${userId}`)
}

export async function cacheFeed(userId: string, posts: unknown[]) {
  await cacheJson(`feed:${userId}`, posts)
}

export async function readCachedFeed<T>(userId: string) {
  return readCachedJson<T[]>(`feed:${userId}`)
}

export async function queueMessage(message: QueuedMessage) {
  const db = await openDb()
  if (!db) {
    const existing = (await getValue<QueuedMessage[]>(`messageQueue:${message.userId}`)) || []
    if (!existing.some(item => item.clientMessageId === message.clientMessageId)) existing.push(message)
    await putValue(`messageQueue:${message.userId}`, existing)
    return
  }
  await new Promise<void>(resolve => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite')
    tx.objectStore(QUEUE_STORE).put(message)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  db.close()
}

export async function readQueuedMessages(userId: string): Promise<QueuedMessage[]> {
  const db = await openDb()
  if (!db) return (await getValue<QueuedMessage[]>(`messageQueue:${userId}`)) || []
  return await new Promise<QueuedMessage[]>(resolve => {
    const tx = db.transaction(QUEUE_STORE, 'readonly')
    const request = tx.objectStore(QUEUE_STORE).getAll()
    request.onsuccess = () => resolve((request.result as QueuedMessage[]).filter(item => item.userId === userId))
    request.onerror = () => resolve([])
  }).finally(() => db.close())
}

export async function removeQueuedMessage(userId: string, clientMessageId: string) {
  const db = await openDb()
  if (!db) {
    const items = (await getValue<QueuedMessage[]>(`messageQueue:${userId}`)) || []
    await putValue(`messageQueue:${userId}`, items.filter(item => item.clientMessageId !== clientMessageId))
    return
  }
  await new Promise<void>(resolve => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite')
    tx.objectStore(QUEUE_STORE).delete(clientMessageId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  db.close()
}
