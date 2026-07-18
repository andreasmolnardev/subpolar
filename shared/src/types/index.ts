import { z } from 'zod'
import {
  UserPreferencesSchema,
  SettingsResponseSchema,
  UpdateSettingsRequestSchema,
  CustomCommandSchema,
  PiConfigSchema,
  PiConfigMetadataSchema,
  CreatePiConfigRequestSchema,
  UpdatePiConfigRequestSchema,
  PiConfigResponseSchema,
  ServerEnvVarSchema,
} from '../schemas/settings'
import {
  ProjectSchema,
  CreateProjectRequestSchema,
  UpdateProjectRequestSchema,
  ProjectStatusSchema,
  GeneralChatInitRequestSchema,
} from '../schemas/project'
import { GeneralChatStatusSchema } from '../schemas/repo'
import {
  FileInfoSchema,
  CreateFileRequestSchema,
  RenameFileRequestSchema,
  FileUploadResponseSchema,
  ChunkedFileInfoSchema,
  FileRangeRequestSchema,
  PatchOperationSchema,
  FilePatchRequestSchema,
} from '../schemas/files'
import {
  SessionSchema,
  MessageSchema,
} from '../schemas/runtime'
import {
  NotificationPreferencesSchema,
  PushSubscriptionRequestSchema,
  PushSubscriptionRecordSchema,
  PushNotificationPayloadSchema,
} from '../schemas/notifications'
import {
  AssistantNotificationPrioritySchema,
  AssistantNotificationRequestSchema,
  AssistantNotificationResponseSchema,
  AssistantSettingsPatchSchema,
} from '../schemas/internal-assistant'
import {
  AgentDefinitionSchema,
  AgentModeSchema,
  AgentSourceSchema,
  ToolDefinitionSchema,
  ToolAdapterTypeSchema,
  ToolRiskSchema,
  AgentToolPolicySchema,
  ToolListRequestSchema,
  ToolDescribeRequestSchema,
  ToolCallRequestSchema,
  ToolCallResponseSchema,
  ToolApprovalSchema,
  ToolAuditRecordSchema,
  IntegrationSchema,
  IntegrationTypeSchema,
} from '../schemas/subpolar-cli'

export type UserPreferences = z.infer<typeof UserPreferencesSchema>
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>
export type CustomCommand = z.infer<typeof CustomCommandSchema>
export type ServerEnvVar = z.infer<typeof ServerEnvVarSchema>
export type PiConfig = z.infer<typeof PiConfigMetadataSchema>
export type PiConfigInput = z.infer<typeof PiConfigSchema>
export type CreatePiConfigRequest = z.infer<typeof CreatePiConfigRequestSchema>
export type UpdatePiConfigRequest = z.infer<typeof UpdatePiConfigRequestSchema>
export type PiConfigResponse = z.infer<typeof PiConfigResponseSchema>
export type OpenCodeConfig = PiConfig
export type OpenCodeConfigInput = PiConfigInput
export type CreateOpenCodeConfigRequest = CreatePiConfigRequest
export type UpdateOpenCodeConfigRequest = UpdatePiConfigRequest
export type OpenCodeConfigResponse = PiConfigResponse

export type Project = z.infer<typeof ProjectSchema>
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>
export type GeneralChatStatus = z.infer<typeof GeneralChatStatusSchema>
export type GeneralChatInitRequest = z.infer<typeof GeneralChatInitRequestSchema>

export type FileInfo = z.infer<typeof FileInfoSchema>
export type CreateFileRequest = z.infer<typeof CreateFileRequestSchema>
export type RenameFileRequest = z.infer<typeof RenameFileRequestSchema>
export type FileUploadResponse = z.infer<typeof FileUploadResponseSchema>
export type ChunkedFileInfo = z.infer<typeof ChunkedFileInfoSchema>
export type FileRangeRequest = z.infer<typeof FileRangeRequestSchema>
export type PatchOperation = z.infer<typeof PatchOperationSchema>
export type FilePatchRequest = z.infer<typeof FilePatchRequestSchema>

export type Session = z.infer<typeof SessionSchema>
export type Message = z.infer<typeof MessageSchema>

export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>
export type PushSubscriptionRequest = z.infer<typeof PushSubscriptionRequestSchema>
export type PushSubscriptionRecord = z.infer<typeof PushSubscriptionRecordSchema>
export type PushNotificationPayload = z.infer<typeof PushNotificationPayloadSchema>

export type AssistantNotificationPriority = z.infer<typeof AssistantNotificationPrioritySchema>
export type AssistantNotificationRequest = z.infer<typeof AssistantNotificationRequestSchema>
export type AssistantNotificationResponse = z.infer<typeof AssistantNotificationResponseSchema>
export type AssistantSettingsPatch = z.infer<typeof AssistantSettingsPatchSchema>

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>
export type AgentMode = z.infer<typeof AgentModeSchema>
export type AgentSource = z.infer<typeof AgentSourceSchema>
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>
export type ToolAdapterType = z.infer<typeof ToolAdapterTypeSchema>
export type ToolRisk = z.infer<typeof ToolRiskSchema>
export type AgentToolPolicy = z.infer<typeof AgentToolPolicySchema>
export type ToolListRequest = z.infer<typeof ToolListRequestSchema>
export type ToolDescribeRequest = z.infer<typeof ToolDescribeRequestSchema>
export type ToolCallRequest = z.infer<typeof ToolCallRequestSchema>
export type ToolCallResponse = z.infer<typeof ToolCallResponseSchema>
export type ToolApproval = z.infer<typeof ToolApprovalSchema>
export type ToolAuditRecord = z.infer<typeof ToolAuditRecordSchema>
export type Integration = z.infer<typeof IntegrationSchema>
export type IntegrationType = z.infer<typeof IntegrationTypeSchema>

export { FetchError } from './errors'
export type { ApiErrorResponse, ApiErrorCode } from './errors'
export { BLOCKED_SERVER_ENV_KEYS, DEFAULT_SERVER_ENV_VARS } from '../schemas/settings'

export interface SuccessResponse {
  success: boolean
}

export type { SSHHostKeyRequest, SSHHostKeyResponse, TrustedSSHHost } from '../schemas/ssh'
export type { GitCredential } from '../schemas/settings'
export type {
  ProviderApiConfig,
  ModelConfig,
  ProviderConfig,
  ProviderSource,
} from '../schemas/settings'

export type {
  AutomationMode,
  AutomationRunTriggerSource,
  AutomationRunStatus,
  AutomationSkillMetadata,
  AutomationJob,
  AutomationRun,
  CreateAutomationJobRequest,
  UpdateAutomationJobRequest,
  PromptTemplate,
  CreatePromptTemplateRequest,
  UpdatePromptTemplateRequest,
} from '../schemas/automation'

export type {
  SkillScope,
  SkillFrontmatter,
  CreateSkillRequest,
  UpdateSkillRequest,
  SkillFileInfo,
} from '../schemas/skills'
export {
  SKILL_NAME_REGEX,
  SkillNameSchema,
  SkillScopeSchema,
  SkillFrontmatterSchema,
  CreateSkillRequestSchema,
  UpdateSkillRequestSchema,
} from '../schemas/skills'
