import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDesktop } from "@/hooks/useDesktop";
import { useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";
import { useAuth } from "@/hooks/useAuth";
import { useUrlParams } from "@/hooks/useUrlParams";
import { createProject, getProject, hasProjectId, listProjects } from "@/api/projects";
import { listStoredSessions, updateStoredSession } from "@/api/sessions";
import { settingsApi, type AgentToolPolicyEffect } from "@/api/settings";
import { DEFAULT_USER_PREFERENCES } from "@/api/types/settings";
import { useAgents } from "@/hooks/usePiHarness";
import { useSettings } from "@/hooks/useSettings";
import { SUBPOLAR_API_BASE_URL } from "@/config";
import { GENERAL_CHAT_PROJECT_ID } from "@subpolar/shared/utils";
import type { AgentSkillAccess } from "@subpolar/shared";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  History,
  Home,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sidebar, SidebarCollapseToggle } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AgentDialog } from "@/components/settings/AgentDialog";
import { ProjectDialog } from "@/components/project/ProjectDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { showToast } from "@/lib/toast";
import { getSidebarProjectRoute } from "@/lib/projectNavigation";

function SidebarSection({
  label,
  icon: Icon,
  collapsed,
  expanded,
  onToggle,
  onClick,
  active,
  action,
  children,
}: {
  label: string;
  icon?: React.ElementType;
  collapsed: boolean;
  expanded: boolean;
  onToggle: () => void;
  onClick: () => void;
  active?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (collapsed) return null;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors text-left",
            active
              ? "bg-accent text-accent-foreground font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
          )}
        >
          {Icon && <Icon className="h-4 w-4 flex-shrink-0" />}
          <span className="truncate">{label}</span>
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
        >
          {expanded
            ? <ChevronDown className="h-3 w-3 flex-shrink-0" />
            : <ChevronRight className="h-3 w-3 flex-shrink-0" />}
        </button>
        {action}
      </div>
      {expanded && (
        <div className="flex flex-col gap-0.5 px-2 pb-1">
          {children}
        </div>
      )}
    </div>
  );
}

function SidebarNavItem({
  icon: Icon,
  label,
  active,
  onClick,
  onDoubleClick,
  indent,
}: {
  icon?: React.ElementType;
  label: string;
  active?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors w-full text-left",
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
        indent && "pl-8",
      )}
    >
      {Icon && <Icon className="h-4 w-4 flex-shrink-0" />}
      <span className="truncate">{label}</span>
    </button>
  );
}

function SidebarAgentItem({
  label,
  active,
  onClick,
  onEdit,
  onDelete,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-center gap-1 rounded-md">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2 pl-8 text-sm transition-colors text-left",
          active
            ? "bg-accent text-accent-foreground font-medium"
            : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
        )}
      >
        <span className="min-w-0 whitespace-normal break-words">{label}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:opacity-100 group-hover:opacity-100"
            aria-label={`Agent actions for ${label}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem className="text-red-500 focus:text-red-600" onSelect={onDelete}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

interface Agent {
  prompt?: string;
  systemPrompt?: string;
  description?: string;
  mode?: "subagent" | "primary" | "all";
  temperature?: number;
  topP?: number;
  top_p?: number;
  model?: string;
  tools?: Record<string, boolean>;
  permission?: {
    edit?: "ask" | "allow" | "deny";
    bash?: "ask" | "allow" | "deny" | Record<string, "ask" | "allow" | "deny">;
    webfetch?: "ask" | "allow" | "deny";
  };
  icon?: string;
  skills?: string[];
  skillAccess?: AgentSkillAccess[];
  allowedCommands?: string[];
  toolAccess?: Array<{ type: "builtin" | "skill" | "cli" | "subpolar"; id: string; permission: "allow" | "ask" | "deny"; command?: string }>;
  disable?: boolean;
  [key: string]: unknown;
}

function policyEffect(permission: "allow" | "ask" | "deny"): AgentToolPolicyEffect {
  if (permission === "ask") return "approval";
  return permission;
}

function subpolarPolicies(agent: Agent) {
  const policies = (agent.toolAccess ?? [])
    .filter((tool) => tool.type === "subpolar")
    .map((tool) => ({ toolId: tool.id, effect: policyEffect(tool.permission) }));
  if (policies.some((policy) => policy.effect !== "deny") && !policies.some((policy) => policy.toolId === "tools.list")) {
    return [{ toolId: "tools.list", effect: "allow" as const }, ...policies];
  }
  return policies;
}

export function DesktopSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { updateParams } = useUrlParams();
  const [collapsed, toggle] = useSidebarCollapsed();
  const { isAuthenticated, isLoading, user } = useAuth();
  const { preferences } = useSettings();
  const isDesktop = useDesktop();

  const [agentsExpanded, setAgentsExpanded] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [selectedSidebarProjectId, setSelectedSidebarProjectId] = useState<string>(String(GENERAL_CHAT_PROJECT_ID));
  const [isCreateAgentDialogOpen, setIsCreateAgentDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<{ name: string; agent: Agent } | null>(null);
  const [editingSession, setEditingSession] = useState<{ id: string; title: string } | null>(null);
  const sessionInputRef = useRef<HTMLInputElement>(null);
  const [isCreateProjectDialogOpen, setIsCreateProjectDialogOpen] = useState(false);
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });

  const { data: generalChatProject } = useQuery({
    queryKey: ["project", GENERAL_CHAT_PROJECT_ID],
    queryFn: () => getProject(GENERAL_CHAT_PROJECT_ID),
    enabled: isAuthenticated,
  });

  const generalChatDirectory = generalChatProject?.fullPath;

  const { data: storedSessions } = useQuery({
    queryKey: ["sessions"],
    queryFn: listStoredSessions,
  });

  const { data: generalChatAgents = [] } = useAgents(SUBPOLAR_API_BASE_URL, generalChatDirectory);
  const hiddenSidebarAgents = useMemo(
    () => new Set((preferences?.hiddenSidebarAgents ?? DEFAULT_USER_PREFERENCES.hiddenSidebarAgents).map((name) => name.toLowerCase())),
    [preferences?.hiddenSidebarAgents],
  );
  const visibleGeneralChatAgents = generalChatAgents.filter((agent) => !hiddenSidebarAgents.has(agent.name.toLowerCase()));
  const navigableProjects = useMemo(() => projects?.filter(hasProjectId) ?? [], [projects]);
  const selectedSidebarProject = selectedSidebarProjectId === String(GENERAL_CHAT_PROJECT_ID)
    ? generalChatProject
    : navigableProjects.find((project) => String(project.id) === selectedSidebarProjectId);
  const selectedSidebarDirectory = selectedSidebarProject?.fullPath;
  const { data: projectAgents = [] } = useAgents(SUBPOLAR_API_BASE_URL, selectedSidebarDirectory);
  const visibleProjectAgents = useMemo(() => {
    const base = projectAgents.filter((agent) => !hiddenSidebarAgents.has(agent.name.toLowerCase()));
    const overrideNames = selectedSidebarProject?.hasAgentOverride ? new Set(selectedSidebarProject.agentNames ?? []) : null;
    return overrideNames ? base.filter((agent) => overrideNames.has(agent.name)) : base;
  }, [hiddenSidebarAgents, projectAgents, selectedSidebarProject?.agentNames, selectedSidebarProject?.hasAgentOverride]);

  const selectedProjectSessions = useMemo(() => {
    if (!storedSessions) return [];
    return storedSessions
      .filter((session) => {
        if (selectedSidebarProjectId === String(GENERAL_CHAT_PROJECT_ID)) {
          return session.projectId === GENERAL_CHAT_PROJECT_ID || session.directory === generalChatDirectory;
        }
        return String(session.projectId) === selectedSidebarProjectId || session.directory === selectedSidebarDirectory;
      })
      .slice(0, 5);
  }, [generalChatDirectory, selectedSidebarDirectory, selectedSidebarProjectId, storedSessions]);

  const { data: subpolarSkills } = useQuery({
    queryKey: ["managed-skills"],
    queryFn: () => settingsApi.listManagedSkills(),
    staleTime: 5 * 60 * 1000,
  });

  const queryClient = useQueryClient();
  const editingSessionId = editingSession?.id;

  const updateSessionMutation = useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      updateStoredSession(sessionId, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : "Failed to update session name");
    },
  });

  useEffect(() => {
    if (editingSessionId) {
      sessionInputRef.current?.focus();
      sessionInputRef.current?.select();
    }
  }, [editingSessionId]);

  const handleCreateAgent = async (name: string, agent: Agent) => {
    try {
      const savedAgent = await settingsApi.createAgent({
        name,
        description: agent.description ?? "",
        mode: agent.mode === "all" ? "primary" : agent.mode ?? "subagent",
        prompt: agent.prompt ?? "",
        systemPrompt: agent.systemPrompt ?? "",
        permission: agent.permission ?? {},
        skills: agent.skills ?? [],
        skillAccess: agent.skillAccess ?? [],
        enabled: !agent.disable,
        sort_order: 0,
      });
      await settingsApi.replaceAgentToolPolicies(savedAgent.id, subpolarPolicies(agent));
      await queryClient.invalidateQueries({ queryKey: ["agents"] });
      await queryClient.invalidateQueries({ queryKey: ["subpolar", "agents"] });
      await queryClient.invalidateQueries({ queryKey: ["agent"] });
      setIsCreateAgentDialogOpen(false);
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : "Failed to create agent");
      throw error;
    }
  };

  const handleSaveAgent = async (name: string, agent: Agent) => {
    if (!editingAgent) {
      handleCreateAgent(name, agent);
      return;
    }

    try {
      const savedAgent = await settingsApi.updateAgent(editingAgent.name, {
        name,
        description: agent.description ?? "",
        mode: agent.mode === "all" ? "primary" : agent.mode ?? "subagent",
        prompt: agent.prompt ?? "",
        systemPrompt: agent.systemPrompt ?? "",
        permission: agent.permission ?? {},
        skills: agent.skills ?? [],
        skillAccess: agent.skillAccess ?? [],
        enabled: !agent.disable,
        sort_order: 0,
      });
      await settingsApi.replaceAgentToolPolicies(savedAgent.id, subpolarPolicies(agent));
      await queryClient.invalidateQueries({ queryKey: ["agents"] });
      await queryClient.invalidateQueries({ queryKey: ["subpolar", "agents"] });
      await queryClient.invalidateQueries({ queryKey: ["agent"] });
      setEditingAgent(null);
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : "Failed to update agent");
      throw error;
    }
  };

  const handleDeleteAgent = async (name: string) => {
    try {
      await settingsApi.deleteAgent(name);
      await queryClient.invalidateQueries({ queryKey: ["agents"] });
      await queryClient.invalidateQueries({ queryKey: ["subpolar", "agents"] });
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : "Failed to delete agent");
    }
  };

  const handleCreateProject = async (data: { name: string; mode: 'existing' | 'workspace'; directory?: string; agentNames?: string[] }) => {
    const created = await createProject(data);
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    setSelectedSidebarProjectId(String(created.id));
    setIsCreateProjectDialogOpen(false);
    showToast.success("Project created");
  };

  if (isLoading || !isAuthenticated) {
    return null;
  }

  if (!isDesktop) {
    return null;
  }

  const isActive = (path: string) => {
    if (path === "/home") {
      return location.pathname === "/" || location.pathname.startsWith("/home");
    }
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const isAgentActive = (name: string) => {
    return location.pathname === `/agents/${encodeURIComponent(name)}`;
  };

  const getSessionProjectId = (directory: string | null, projectId: number | null) => {
    if (projectId !== null) return projectId;
    if (directory && directory === generalChatDirectory) return GENERAL_CHAT_PROJECT_ID;
    return navigableProjects.find((project) => project.fullPath === directory)?.id ?? GENERAL_CHAT_PROJECT_ID;
  };

  const isSessionActive = (sessionId: string) => {
    return location.pathname.endsWith(`/sessions/${encodeURIComponent(sessionId)}`);
  };

  const saveSessionTitle = () => {
    if (!editingSession) return;
    const title = editingSession.title.trim();
    if (title) {
      updateSessionMutation.mutate({ sessionId: editingSession.id, title });
    }
    setEditingSession(null);
  };

  return (
    <>
      <Sidebar collapsed={collapsed} className="pt-0">
        {/* Brand */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          {!collapsed && (
            <img
              src="/subpolar-logo-text-dark.png"
              alt="Subpolar"
              className="h-6 w-auto sm:h-8"
            />
          )}
          <SidebarCollapseToggle collapsed={collapsed} onToggle={toggle} />
        </div>

        {/* Navigation */}
        <div className="flex flex-col gap-1 p-2 pt-3 flex-1 overflow-y-auto">
          {/* Home */}
          <SidebarNavItem
            icon={Home}
            label="Home"
            active={isActive("/home")}
            onClick={() => navigate("/home")}
          />

          {/* Automations */}
          <SidebarNavItem
            icon={Zap}
            label="Automations"
            onClick={() => navigate("/automations")}
            active={location.pathname === "/automations"}
          />

          {!collapsed && (
            <div className="mt-3 border-t border-border pt-3">
              <div className="mb-2 flex items-center gap-1 px-1">
                <Select
                  value={selectedSidebarProjectId}
onValueChange={(value) => {
                     if (value === "new") {
                       setIsCreateProjectDialogOpen(true);
                       return;
                     }
                     const route = getSidebarProjectRoute(value, projects);
                     if (!route) return;
                     setSelectedSidebarProjectId(value);
                     navigate(route);
                   }}
                >
                  <SelectTrigger className="h-9 min-w-0 flex-1">
                    <SelectValue placeholder="Project" />
                  </SelectTrigger>
                  <SelectContent>
                    {generalChatProject && (
                      <SelectItem value={String(GENERAL_CHAT_PROJECT_ID)}>{generalChatProject.name}</SelectItem>
                    )}
                    {navigableProjects.map((project) => (
                      <SelectItem key={project.id} value={String(project.id)}>
                        {project.name}
                      </SelectItem>
                    ))}
                                          <SelectItem value="new" className="flex items-center">
                          <Plus className="h-4 w-4 mr-1" />
                          Create project
                        </SelectItem>
                      </SelectContent>
                </Select>

              </div>
            </div>
          )}

          <SidebarSection
            label="Agents"
            icon={Bot}
            collapsed={collapsed}
            expanded={agentsExpanded}
            onToggle={() => setAgentsExpanded(!agentsExpanded)}
            onClick={() => navigate("/agents")}
            active={location.pathname === "/agents"}
            action={
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCreateAgentDialogOpen(true);
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            }
          >
{visibleProjectAgents.map((agent) => {
               const name = agent.name;
               const editableAgent: Agent = {
                 prompt: agent.prompt,
                 description: agent.description,
                 mode: agent.mode,
                 model: agent.model ? `${agent.model.providerID}/${agent.model.modelID}` : undefined,
               };
               return (
                 <SidebarAgentItem
                   key={name}
                   label={name}
                   active={isAgentActive(name)}
                   onClick={() => navigate(`/agents/${encodeURIComponent(name)}`)}
                   onEdit={() => setEditingAgent({ name, agent: editableAgent })}
                   onDelete={() => handleDeleteAgent(name)}
                 />
               );
             })}


          </SidebarSection>

          {/* Sessions */}
          <SidebarSection
            label="Sessions"
            icon={History}
            collapsed={collapsed}
            expanded={historyExpanded}
            onToggle={() => setHistoryExpanded(!historyExpanded)}
            onClick={() => navigate("/history")}
            active={location.pathname === "/history"}
          >
{selectedProjectSessions.map((session) => {
                const projectId = getSessionProjectId(session.directory, session.projectId);
                return (
                  editingSession?.id === session.id ? (
                    <input
                      key={session.id}
                      ref={sessionInputRef}
                      type="text"
                      value={editingSession.title}
                      onChange={(event) => setEditingSession({ ...editingSession, title: event.target.value })}
                      onBlur={saveSessionTitle}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          saveSessionTitle();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setEditingSession(null);
                        }
                      }}
                      aria-label="Session name"
                      className="w-full rounded-md border border-primary bg-background px-3 py-2 text-sm text-foreground outline-none ring-2 ring-primary/20"
                    />
                  ) : (
                    <SidebarNavItem
                      key={session.id}
                      label={session.title || session.id}
                      active={isSessionActive(session.id)}
                      onClick={() => navigate(`/projects/${projectId}/sessions/${encodeURIComponent(session.id)}`)}
                      onDoubleClick={() => setEditingSession({ id: session.id, title: session.title || session.id })}
                      indent
                    />
                  )
                );
              })}

          </SidebarSection>
        </div>

        {/* Profile */}
        <div className="border-t border-border mt-auto">
          <button
            type="button"
            onClick={() => {
              updateParams((p) => {
                p.set("settings", "open");
                p.set("settingsTab", "account");
                p.delete("mobileTab");
              }, "push");
            }}
            className={cn(
              "flex items-center gap-3 w-full p-3 hover:bg-accent/50 transition-colors",
              collapsed && "justify-center",
            )}
          >
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary flex-shrink-0 overflow-hidden">
              {user?.image
                ? (
                  <img
                    src={user.image}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )
                : (
                  (user?.name?.[0] || user?.email?.[0] || "?").toUpperCase()
                )}
            </div>
            {!collapsed && (
              <div className="flex flex-col items-start min-w-0">
                <span className="text-sm font-medium text-foreground truncate w-full text-left">
                  {user?.name || "User"}
                </span>
                <span className="text-xs text-muted-foreground truncate w-full text-left">
                  {user?.email || ""}
                </span>
              </div>
            )}
          </button>
        </div>
      </Sidebar>

      <AgentDialog
        open={isCreateAgentDialogOpen}
        onOpenChange={setIsCreateAgentDialogOpen}
        onSubmit={handleCreateAgent}
        editingAgent={null}
        availableSkills={subpolarSkills || []}
      />
      <AgentDialog
        open={editingAgent !== null}
        onOpenChange={(open) => {
          if (!open) setEditingAgent(null);
        }}
        onSubmit={handleSaveAgent}
        editingAgent={editingAgent}
        availableSkills={subpolarSkills || []}
      />
      <ProjectDialog
        open={isCreateProjectDialogOpen}
        onOpenChange={setIsCreateProjectDialogOpen}
        onSubmit={handleCreateProject}
        availableAgents={visibleGeneralChatAgents}
        userId={user?.name || user?.email || "default"}
      />
    </>
  );
}
