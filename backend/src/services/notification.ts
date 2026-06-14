import type PocketBase from 'pocketbase'
import webpush from "web-push"
import { logger } from "../utils/logger"
import type { PushSubscriptionRecord } from "../types/settings"
import type { PushNotificationPayload } from "@subpolar/shared/types"
import {
  NotificationEventType,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from "@subpolar/shared/schemas"
import {
  getPermissionLabel,
  getPermissionDetail,
  getQuestionText,
} from "@subpolar/shared/notifications"
import { SettingsService } from "./settings"
import { sseAggregator, type SSEEvent } from "./sse-aggregator"
import { getRepoByLocalPath, getRepoBySourcePath } from "../db/queries"
import { getReposPath } from "@subpolar/shared/config/env"
import path from "path"

interface VapidConfig {
  publicKey: string
  privateKey: string
  subject: string
}

interface PushSubRecord {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  device_name: string | null
  created_at: number
  last_used_at: number | null
}

const EVENT_CONFIG: Record<
  string,
  {
    preferencesKey: keyof typeof DEFAULT_NOTIFICATION_PREFERENCES.events
    titleFn: (props: Record<string, unknown>) => string
    bodyFn: (props: Record<string, unknown>) => string
  }
> = {
  [NotificationEventType.PERMISSION_ASKED]: {
    preferencesKey: "permissionAsked",
    titleFn: (props) =>
      getPermissionLabel(
        typeof props.permission === "string" ? props.permission : ""
      ),
    bodyFn: (props) => getPermissionDetail(props).primary || "Approval required",
  },
  [NotificationEventType.QUESTION_ASKED]: {
    preferencesKey: "questionAsked",
    titleFn: () => "Question",
    bodyFn: (props) => getQuestionText(props) || "A question needs your answer",
  },
  [NotificationEventType.SESSION_ERROR]: {
    preferencesKey: "sessionError",
    titleFn: () => "Error",
    bodyFn: (props) => {
      const error = props.error as { message?: string } | undefined
      return error?.message ?? "A session encountered an error"
    },
  },
  [NotificationEventType.SESSION_IDLE]: {
    preferencesKey: "sessionIdle",
    titleFn: () => "Session complete",
    bodyFn: () => "Your session has finished processing",
  },
}

const MAX_BODY_LENGTH = 140

export function buildEventNotificationPayload(
  event: SSEEvent,
  context: {
    repoName?: string
    repoId?: number
    sessionId?: string
    directory?: string
    url: string
  }
): PushNotificationPayload | null {
  const config = EVENT_CONFIG[event.type]
  if (!config) return null

  const action = config.titleFn(event.properties)
  const title = context.repoName
    ? `${context.repoName}: ${action}`
    : action

  const rawBody = config.bodyFn(event.properties)
  const body =
    rawBody.length > MAX_BODY_LENGTH
      ? `${rawBody.slice(0, MAX_BODY_LENGTH - 1)}…`
      : rawBody

  return {
    title,
    body,
    tag: `${event.type}-${context.sessionId ?? "global"}`,
    data: {
      eventType: event.type,
      sessionId: context.sessionId,
      directory: context.directory,
      repoId: context.repoId,
      repoName: context.repoName,
      url: context.url,
    },
  }
}

function recordToSubscription(row: PushSubRecord): PushSubscriptionRecord {
  return {
    id: parseInt(row.id, 10) || 0,
    userId: row.user_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    deviceName: row.device_name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }
}

export class NotificationService {
  private vapidConfig: VapidConfig | null = null
  private settingsService: SettingsService

  constructor(private pb: PocketBase) {
    this.settingsService = new SettingsService(pb)
  }

  configureVapid(config: VapidConfig): void {
    this.vapidConfig = config
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey)
  }

  getVapidPublicKey(): string | null {
    return this.vapidConfig?.publicKey ?? null
  }

  isConfigured(): boolean {
    return this.vapidConfig !== null
  }

  async saveSubscription(
    userId: string,
    endpoint: string,
    p256dh: string,
    auth: string,
    deviceName?: string
  ): Promise<PushSubscriptionRecord> {
    const now = Date.now()

    try {
      const existing = await this.pb.collection('push_subscriptions').getFirstListItem(
        `endpoint = "${endpoint}"`
      )
      await this.pb.collection('push_subscriptions').update(existing.id, {
        user_id: userId,
        p256dh,
        auth,
        device_name: deviceName ?? null,
        last_used_at: now,
      })
      const updated = await this.pb.collection('push_subscriptions').getOne(existing.id)
      return recordToSubscription(updated as unknown as PushSubRecord)
    } catch {
      const record = await this.pb.collection('push_subscriptions').create({
        user_id: userId,
        endpoint,
        p256dh,
        auth,
        device_name: deviceName ?? null,
        created_at: now,
        last_used_at: now,
      })
      return recordToSubscription(record as unknown as PushSubRecord)
    }
  }

  async removeSubscription(endpoint: string, userId?: string): Promise<boolean> {
    try {
      const filter = userId
        ? `endpoint = "${endpoint}" && user_id = "${userId}"`
        : `endpoint = "${endpoint}"`
      const record = await this.pb.collection('push_subscriptions').getFirstListItem(filter)
      await this.pb.collection('push_subscriptions').delete(record.id)
      return true
    } catch {
      return false
    }
  }

  async removeSubscriptionById(id: number, userId: string): Promise<boolean> {
    try {
      const record = await this.pb.collection('push_subscriptions').getOne(String(id))
      const r = record as unknown as PushSubRecord
      if (r.user_id !== userId) return false
      await this.pb.collection('push_subscriptions').delete(record.id)
      return true
    } catch {
      return false
    }
  }

  async getSubscriptions(userId: string): Promise<PushSubscriptionRecord[]> {
    const result = await this.pb.collection('push_subscriptions').getFullList({
      filter: `user_id = "${userId}"`,
      sort: '-created_at',
    })
    return (result as unknown as PushSubRecord[]).map(recordToSubscription)
  }

  async getAllUserIds(): Promise<string[]> {
    const result = await this.pb.collection('push_subscriptions').getFullList({
      fields: 'user_id',
    })
    const seen = new Set<string>()
    for (const r of result as unknown as Array<{ user_id: string }>) {
      seen.add(r.user_id)
    }
    return Array.from(seen)
  }

  async handleSSEEvent(
    _directory: string,
    event: SSEEvent
  ): Promise<void> {
    const config = EVENT_CONFIG[event.type]
    if (!config) return

    const sessionId = event.properties.sessionID as string | undefined
    if (sessionId && sseAggregator.isSessionBeingViewed(sessionId)) return
    if (sessionId && sseAggregator.isSubagentSession(sessionId)) return

    if (!this.isConfigured()) return

    const userIds = await this.getAllUserIds()
    if (userIds.length === 0) return

    let notificationUrl = "/"
    let repoName = ""
    let repoId: number | undefined

    if (_directory) {
      const reposBasePath = getReposPath()
      const localPath = path.relative(reposBasePath, _directory)
      const repo = await (getRepoBySourcePath(this.pb, path.resolve(_directory)) ?? getRepoByLocalPath(this.pb, localPath))

      if (repo) {
        repoId = repo.id
        repoName = path.basename(repo.localPath)
        notificationUrl = sessionId
          ? `/repos/${repo.id}/sessions/${sessionId}`
          : `/repos/${repo.id}`
      }
    }

    const payload = buildEventNotificationPayload(event, {
      repoName: repoName || undefined,
      repoId,
      sessionId,
      directory: _directory,
      url: notificationUrl,
    })
    if (!payload) return

    for (const userId of userIds) {
      const settings = await this.settingsService.getSettings(userId)
      const notifPrefs =
        settings.preferences.notifications ?? DEFAULT_NOTIFICATION_PREFERENCES

      if (!notifPrefs.enabled) continue
      if (!notifPrefs.events[config.preferencesKey]) continue

      await this.sendToUser(userId, payload)
    }
  }

  async sendTestNotification(userId: string): Promise<void> {
    await this.sendToUser(userId, {
      title: "Test Notification",
      body: "Push notifications are working correctly",
      tag: "test",
      data: { eventType: "test", url: "/" },
    })
  }

  async sendToUser(
    userId: string,
    payload: PushNotificationPayload
  ): Promise<{ delivered: number; expired: number; failed: number; total: number }> {
    const subscriptions = await this.getSubscriptions(userId)
    const expiredEndpoints: string[] = []
    let delivered = 0
    let failed = 0

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify(payload)
          )

          try {
            const existing = await this.pb.collection('push_subscriptions').getFirstListItem(
              `endpoint = "${sub.endpoint}"`
            )
            await this.pb.collection('push_subscriptions').update(existing.id, {
              last_used_at: Date.now(),
            })
          } catch {
            // ignore if subscription was removed
          }

          delivered++
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode

          if (statusCode === 404 || statusCode === 410) {
            expiredEndpoints.push(sub.endpoint)
          } else {
            logger.error(`Push delivery failed for ${sub.endpoint.slice(0, 50)}:`, error)
            failed++
          }
        }
      })
    )

    for (const endpoint of expiredEndpoints) {
      await this.removeSubscription(endpoint)
    }

    return {
      delivered,
      expired: expiredEndpoints.length,
      failed,
      total: subscriptions.length,
    }
  }
}
