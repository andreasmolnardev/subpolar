import { useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react";
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
import { useAgents, useConfig, useCreateSession } from "@/hooks/useOpenCode";
import { getProviders } from "@/api/providers";
import { listProjects } from "@/api/projects";
import { OPENCODE_API_ENDPOINT } from "@/config";
import { showToast } from "@/lib/toast";

const PERMISSION_OPTIONS = [
  { value: "default", label: "Default Permissions" },
  { value: "ask", label: "Ask for Permissions" },
  { value: "none", label: "No Permissions" },
  { value: "allow_all", label: "Dangerously Allow All" },
] as const;

interface ChatInputBarProps {
  placeholder?: string;
  onSend?: () => void;
}

export function ChatInputBar(
  { placeholder = "Send a message...", onSend }: ChatInputBarProps,
) {
  const navigate = useNavigate();

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedProjectIdRef = useRef<string>("general");
  const selectedAgentRef = useRef<string>("__default__");
  const selectedModelRef = useRef<string>("__auto__");
  const selectedPermissionRef = useRef<string>("default");

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

  const createSession = useCreateSession(opcodeUrl, undefined);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [],
  );

  const handleTextareaInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      e.target.style.height = "auto";
      e.target.style.height = `${e.target.scrollHeight}px`;
    },
    [],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      selectedModelRef.current = value;
    },
    [],
  );

  const handleSubmit = useCallback(async () => {
    const prompt = textareaRef.current?.value.trim();
    if (!prompt) return;

    try {
      const session = await createSession.mutateAsync({
        agent: selectedAgentRef.current === "__default__"
          ? undefined
          : selectedAgentRef.current,
      });

      navigate(`/repos/0/sessions/${session.id}`, {
        state: { initialPrompt: prompt },
      });

      onSend?.();
    } catch {
      showToast.error("Failed to create session");
    }
  }, [createSession, navigate, onSend]);

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="relative backdrop-blur-md bg-muted/50 rounded-xl p-2 shadow-lg">
        <textarea
          ref={textareaRef}
          onChange={handleTextareaInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          style={{ height: "auto", overflow: "hidden" }}
          className="w-full bg-transparent px-3 py-2.5 text-[16px] text-foreground placeholder-muted-foreground focus:outline-none focus:bg-muted/70 resize-none md:text-sm rounded-lg"
        />

        <div className="flex mt-3 items-center">
          {/* Project */}
          <div className="flex items-center gap-1.5">
            <div>
              <Select
                onValueChange={(v) => (selectedProjectIdRef.current = v)}
              >
                <SelectTrigger className="h-8 text-xs border-0 bg-transparent focus:ring-0 focus:ring-offset-0  gap-2">
                  <SelectValue placeholder="Project" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px] overflow-y-auto">
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Agent */}
          <div className="flex items-center gap-1.5">
            <div>
              <Select
                defaultValue="__default__"
                onValueChange={(v) => (selectedAgentRef.current = v)}
              >
                <SelectTrigger className="h-8 text-xs border-0 bg-transparent focus:ring-0 focus:ring-offset-0  gap-2">
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
            </div>
          </div>

          {/* Model */}
          <div className="flex items-center gap-1.5">
            <div>
              <Select onValueChange={handleModelChange}>
                <SelectTrigger className="h-8 text-xs border-0 bg-transparent focus:ring-0 focus:ring-offset-0 gap-2">
                  <SelectValue placeholder="Model" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px] overflow-y-auto">
                  <SelectItem value="__auto__">Auto</SelectItem>
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
            </div>
          </div>

          {/* Permissions */}
              <Select
                defaultValue="default"
                onValueChange={(v) => (selectedPermissionRef.current = v)}
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

          <span className="w-full"/>

          {/* Send */}
          <Button
            onClick={handleSubmit}
            disabled={createSession.isPending}
            size="icon"
            className="h-8 w-8 flex-shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
