import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FolderKanban, Paperclip, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAgents, useAbortSession, useConfig, useCreateSession, useSendPrompt } from "@/hooks/useOpenCode";
import { getProviders } from "@/api/providers";
import { listProjects } from "@/api/projects";
import { OPENCODE_API_ENDPOINT } from "@/config";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useSessionStatusForSession } from "@/stores/sessionStatusStore";

export interface ChatInputBarHandle {
  setPromptValue: (value: string) => void;
  clearPrompt: () => void;
  triggerFileUpload: () => void;
}

const PERMISSION_OPTIONS = [
  { value: "default", label: "Default Permissions" },
  { value: "ask", label: "Ask for Permissions" },
  { value: "none", label: "No Permissions" },
  { value: "allow_all", label: "Dangerously Allow All" },
] as const;

interface ChatInputBarProps {
  placeholder?: string;
  onSend?: () => void;
  defaultProjectId?: string;
  defaultAgent?: string;
  defaultModel?: string;
  defaultPermission?: string;
  sendImmediately?: boolean;
  sessionID?: string;
  directory?: string;
  disabled?: boolean;
  isSessionActive?: boolean;
  onPromptChange?: (hasContent: boolean) => void;
  onScrollToBottom?: () => void;
}

export const ChatInputBar = forwardRef<ChatInputBarHandle, ChatInputBarProps>(function ChatInputBar(
  {
    placeholder = "Send a message...",
    onSend,
    defaultProjectId,
    defaultAgent = "__default__",
    defaultModel = "__auto__",
    defaultPermission = "default",
    sendImmediately = false,
    sessionID,
    directory,
    disabled = false,
    isSessionActive = false,
    onPromptChange,
    onScrollToBottom,
  }: ChatInputBarProps,
  ref,
) {
  const navigate = useNavigate();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(defaultProjectId ?? null);
  const [selectedAgent, setSelectedAgent] = useState(defaultAgent);
  const [selectedModel, setSelectedModel] = useState(defaultModel);
  const [selectedPermission, setSelectedPermission] = useState(defaultPermission);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();

  const opcodeUrl = OPENCODE_API_ENDPOINT;

  const { data: agents = [] } = useAgents(opcodeUrl);
  const { data: config } = useConfig(opcodeUrl);

  const { data: providersData } = useQuery({
    queryKey: ["opencode", "providers", opcodeUrl],
    queryFn: () => getProviders(),
    staleTime: 30000,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });

  const models = useMemo(() => {
    const providers = providersData?.providers;
    if (!providers) return [];

    const configuredProviders = config?.provider ?? {};
    const disabledProviders = new Set(config?.disabled_providers ?? []);
    const connectedProviders = new Set(providersData?.connected ?? []);

    const result: {
      id: string;
      providerID: string;
      modelID: string;
      name: string;
      providerName: string;
    }[] = [];

    for (const provider of providers) {
      if (disabledProviders.has(provider.id)) continue;

      const isConfigured = provider.id in configuredProviders;
      const isConnected = connectedProviders.has(provider.id);
      if (!isConfigured && !isConnected) continue;

      const configuredModels = configuredProviders[provider.id]?.models;
      const enabledModelKeys = configuredModels
        ? new Set(Object.keys(configuredModels))
        : null;

      for (const [key, model] of Object.entries(provider.models)) {
        if (enabledModelKeys && !enabledModelKeys.has(key)) continue;

        result.push({
          id: `${provider.id}/${key}`,
          providerID: provider.id,
          modelID: key,
          name: model.name || key,
          providerName: provider.name,
        });
      }
    }

    return result;
  }, [providersData, config]);

  const modelsByProvider = useMemo(() => {
    const map = new Map<string, typeof models>();
    for (const model of models) {
      const group = map.get(model.providerName) ?? [];
      group.push(model);
      map.set(model.providerName, group);
    }
    return map;
  }, [models]);

  const selectedProject = selectedProjectId
    ? projects.find((p) => p.id.toString() === selectedProjectId)
    : undefined;
  const selectedDirectory = sessionID ? directory : sendImmediately ? selectedProject?.fullPath : undefined;

  const createSession = useCreateSession(opcodeUrl, selectedDirectory);
  const sendPrompt = useSendPrompt(opcodeUrl, selectedDirectory);
  const abortSession = useAbortSession(opcodeUrl, selectedDirectory, sessionID ?? activeSessionId);
  const activeSessionStatus = useSessionStatusForSession(sessionID ?? activeSessionId);
  const isWaitingForAnswer = isSessionActive || activeSessionStatus.type === "busy" || sendPrompt.isPending;

  useEffect(() => {
    setSelectedProjectId(defaultProjectId ?? null);
  }, [defaultProjectId]);

  useEffect(() => {
    setSelectedAgent(defaultAgent);
  }, [defaultAgent]);

  useEffect(() => {
    setSelectedModel(defaultModel);
  }, [defaultModel]);

  useEffect(() => {
    setSelectedPermission(defaultPermission);
  }, [defaultPermission]);

  useImperativeHandle(ref, () => ({
    setPromptValue: (value: string) => {
      if (!textareaRef.current) return;
      textareaRef.current.value = value;
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      textareaRef.current.focus();
      onPromptChange?.(value.trim().length > 0);
    },
    clearPrompt: () => {
      if (!textareaRef.current) return;
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
      textareaRef.current.focus();
      onPromptChange?.(false);
    },
    triggerFileUpload: () => {
      fileInputRef.current?.click();
    },
  }), [onPromptChange]);

  const handleTextareaInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      e.target.style.height = "auto";
      e.target.style.height = `${e.target.scrollHeight}px`;
      onPromptChange?.(e.target.value.trim().length > 0);
    },
    [onPromptChange],
  );

  const handleSubmit = useCallback(async () => {
    const targetSessionId = sessionID ?? activeSessionId;

    if (isWaitingForAnswer && targetSessionId) {
      abortSession.mutate(targetSessionId);
      return;
    }

    const prompt = textareaRef.current?.value.trim();
    if (!prompt) return;
    if (sendImmediately && !selectedProject) {
      showToast.error("Select a project before sending");
      return;
    }

    if (sessionID) {
      textareaRef.current!.value = "";
      textareaRef.current!.style.height = "auto";
      onPromptChange?.(false);
      sendPrompt.mutate(
        {
          sessionID,
          prompt,
          model: selectedModel === "__auto__" ? undefined : selectedModel,
          agent: selectedAgent === "__default__" ? undefined : selectedAgent,
        },
        {
          onSuccess: () => {
            onScrollToBottom?.();
            onSend?.();
          },
        },
      );
      return;
    }

    try {
      const session = await createSession.mutateAsync({});

      if (sendImmediately) {
        setActiveSessionId(session.id);
        textareaRef.current!.value = "";
        textareaRef.current!.style.height = "auto";
        await sendPrompt.mutateAsync({
          sessionID: session.id,
          prompt,
          model: selectedModel === "__auto__" ? undefined : selectedModel,
          agent: selectedAgent === "__default__" ? undefined : selectedAgent,
        });
        navigate(`/projects/${selectedProjectId}/sessions/${session.id}`);
        onSend?.();
        return;
      }

      setActiveSessionId(session.id);
      textareaRef.current!.value = "";
      textareaRef.current!.style.height = "auto";
      onPromptChange?.(false);
      await sendPrompt.mutateAsync({
        sessionID: session.id,
        prompt,
        model: selectedModel === "__auto__" ? undefined : selectedModel,
        agent: selectedAgent === "__default__" ? undefined : selectedAgent,
      });

      navigate(`/repos/0/sessions/${session.id}`);

      onSend?.();
    } catch {
      showToast.error("Failed to create session");
    }
  }, [
    abortSession,
    activeSessionId,
    createSession,
    sessionID,
    isWaitingForAnswer,
    navigate,
    onPromptChange,
    onScrollToBottom,
    onSend,
    selectedAgent,
    selectedModel,
    selectedProject,
    selectedProjectId,
    sendImmediately,
    sendPrompt,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const selectedProjectName = selectedProject?.name ?? null;

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="relative backdrop-blur-md bg-muted/50 rounded-xl p-4 shadow-lg">
          <textarea
            ref={textareaRef}
            onChange={handleTextareaInput}
            onKeyDown={handleKeyDown}
            disabled={disabled}
          placeholder={placeholder}
          rows={1}
          style={{ height: "auto", overflow: "hidden" }}
            className="w-full bg-transparent text-[18px] text-foreground placeholder-muted-foreground focus:outline-none resize-none rounded-lg"
          />
        <input ref={fileInputRef} type="file" className="hidden" />

        <div className="flex mt-3 items-center">
          <Select
            value={selectedProjectId ?? undefined}
            onValueChange={(v) => {
              setSelectedProjectId(v);
            }}
          >
            <SelectTrigger
              className={cn(
                "h-8 flex-shrink-0 border-0 focus:ring-0 focus:ring-offset-0 text-xs gap-1.5 rounded-md [&>svg:last-child]:hidden",
                selectedProjectId
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 w-auto px-2"
                  : "bg-muted hover:bg-muted/80 w-8 px-0 justify-center",
              )}
            >
              <FolderKanban className="h-4 w-4 flex-shrink-0" />
              {selectedProjectName && (
                <span className="max-w-[80px] truncate">{selectedProjectName}</span>
              )}
            </SelectTrigger>
            <SelectContent className="max-h-[300px] overflow-y-auto">
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id.toString()}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            size="icon"
            className="h-8 w-8 flex-shrink-0 border-0 bg-muted hover:bg-muted/80 text-foreground ml-2"
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          <Select
            value={selectedAgent}
            onValueChange={setSelectedAgent}
          >
            <SelectTrigger className="h-8 text-xs border-0 bg-transparent focus:ring-0 focus:ring-offset-0 gap-2">
              <SelectValue placeholder="Agent" />
            </SelectTrigger>
            <SelectContent className="max-h-[300px] overflow-y-auto">
              <SelectItem value="__default__">Agent</SelectItem>
              {agents.map((agent) => (
                <SelectItem key={agent.name} value={agent.name}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedModel} onValueChange={setSelectedModel}>
            <SelectTrigger className="h-8 text-xs border-0 bg-transparent focus:ring-0 focus:ring-offset-0 gap-2">
              <SelectValue placeholder="Model" />
            </SelectTrigger>
            <SelectContent className="max-h-[300px] overflow-y-auto">
              <SelectItem value="__auto__">Auto Model</SelectItem>
              <SelectSeparator />
              {Array.from(modelsByProvider.entries()).map((
                [providerName, providerModels],
                index,
              ) => (
                <SelectGroup key={providerName}>
                  {index > 0 && <SelectSeparator />}
                  <SelectLabel>{providerName}</SelectLabel>
                  {providerModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={selectedPermission}
            onValueChange={setSelectedPermission}
          >
            <SelectTrigger className="h-8 text-xs border-0 bg-transparent focus:ring-0 focus:ring-offset-0 w-fit gap-2">
              <SelectValue placeholder="Permissions" />
            </SelectTrigger>
            <SelectContent className="max-h-[300px] overflow-y-auto">
              {PERMISSION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="w-full" />

          <Button
            onClick={handleSubmit}
            disabled={disabled || createSession.isPending || abortSession.isPending}
            size="icon"
            className="h-8 w-8 flex-shrink-0"
          >
            {isWaitingForAnswer ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
});
