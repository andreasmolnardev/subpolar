import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDesktop } from "@/hooks/useDesktop";
import { useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";
import { useAuth } from "@/hooks/useAuth";
import { useUrlParams } from "@/hooks/useUrlParams";
import { getProject, listProjects, createProject } from "@/api/projects";
import { listStoredSessions } from "@/api/sessions";
import { settingsApi } from "@/api/settings";
import { useAgents } from "@/hooks/useOpenCode";
import { OPENCODE_API_ENDPOINT } from "@/config";
import { GENERAL_CHAT_PROJECT_ID } from "@subpolar/shared/utils";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  History,
  Home,
  Plus,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sidebar, SidebarCollapseToggle } from "@/components/ui/sidebar";
import { AgentDialog } from "@/components/settings/AgentDialog";
import { ProjectDialog } from "@/components/project/ProjectDialog";

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
  indent,
}: {
  icon?: React.ElementType;
  label: string;
  active?: boolean;
  onClick?: () => void;
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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

interface Agent {
  prompt?: string;
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
  allowedCommands?: string[];
  disable?: boolean;
  [key: string]: unknown;
}

export function DesktopSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { updateParams } = useUrlParams();
  const [collapsed, toggle] = useSidebarCollapsed();
  const { isAuthenticated, isLoading, user } = useAuth();
  const isDesktop = useDesktop();

  const [agentsExpanded, setAgentsExpanded] = useState(true);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [automationsExpanded, setAutomationsExpanded] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [isCreateAgentDialogOpen, setIsCreateAgentDialogOpen] = useState(false);
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

  const { data: generalChatAgents = [] } = useAgents(OPENCODE_API_ENDPOINT, generalChatDirectory);

  const { data: configs } = useQuery({
    queryKey: ["opencode-configs"],
    queryFn: () => settingsApi.getOpenCodeConfigs(),
  });

  const { data: opencodeSkills } = useQuery({
    queryKey: ["managed-skills"],
    queryFn: () => settingsApi.listManagedSkills(),
    staleTime: 5 * 60 * 1000,
  });

  const defaultConfig = configs?.defaultConfig;
  const rawContent = defaultConfig?.rawContent;
  const parsedConfig = rawContent ? tryParseJson(rawContent) : null;

  const queryClient = useQueryClient();

  const updateConfigMutation = useMutation({
    mutationFn: async ({ name, agent }: { name: string; agent: Agent }) => {
      if (!defaultConfig) throw new Error("No default config found");
      const updatedAgents = { ...(parsedConfig?.agents || {}), [name]: agent };
      const updatedContent = { ...parsedConfig, agents: updatedAgents };
      await settingsApi.updateOpenCodeConfig("default", {
        content: JSON.stringify(updatedContent, null, 2),
      });
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opencode-configs"] });
      queryClient.invalidateQueries({
        queryKey: ["opencode", "agents", OPENCODE_API_ENDPOINT, generalChatDirectory],
      });
    },
  });

  const handleCreateAgent = (name: string, agent: Agent) => {
    updateConfigMutation.mutate({ name, agent }, {
      onSuccess: () => {
        setIsCreateAgentDialogOpen(false);
      },
    });
  };

  const handleCreateProject = async (data: { name: string; directory?: string }) => {
    await createProject(data);
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    setIsCreateProjectDialogOpen(false);
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
    return projects?.find((project) => project.fullPath === directory)?.id ?? GENERAL_CHAT_PROJECT_ID;
  };

  const isSessionActive = (sessionId: string) => {
    return location.pathname.endsWith(`/sessions/${encodeURIComponent(sessionId)}`);
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

          {/* Agents */}
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
            {generalChatAgents.map((agent) => {
              const name = agent.name;
              return (
                <SidebarNavItem
                  key={name}
                  label={name}
                  active={isAgentActive(name)}
                  onClick={() =>
                    navigate(`/agents/${encodeURIComponent(name)}`)}
                  indent
                />
              );
            })}
          </SidebarSection>

          {/* Projects */}
          <SidebarSection
            label="Projects"
            icon={FolderKanban}
            collapsed={collapsed}
            expanded={projectsExpanded}
            onToggle={() => setProjectsExpanded(!projectsExpanded)}
            onClick={() => navigate("/projects")}
            active={location.pathname === "/projects"}
            action={
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCreateProjectDialogOpen(true);
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            }
          >
            {projects?.filter((p) => p.id !== 0).map((project) => (
              <SidebarNavItem
                key={project.id}
                label={project.name}
                active={location.pathname === `/projects/${project.id}`}
                onClick={() => navigate(`/projects/${project.id}`)}
                indent
              />
            ))}
          </SidebarSection>

          {/* Automations */}
          <SidebarSection
            label="Automations"
            icon={Zap}
            collapsed={collapsed}
            expanded={automationsExpanded}
            onToggle={() => setAutomationsExpanded(!automationsExpanded)}
            onClick={() => navigate("/automations")}
            active={location.pathname === "/automations"}
          >
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
            {storedSessions?.map((session) => {
              const projectId = getSessionProjectId(session.directory, session.projectId);
              return (
                <SidebarNavItem
                  key={session.id}
                  label={session.title || session.id}
                  active={isSessionActive(session.id)}
                  onClick={() => navigate(`/projects/${projectId}/sessions/${encodeURIComponent(session.id)}`)}
                  indent
                />
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
        availableSkills={opencodeSkills?.map((s) => s.name) || []}
      />
      <ProjectDialog
        open={isCreateProjectDialogOpen}
        onOpenChange={setIsCreateProjectDialogOpen}
        onSubmit={handleCreateProject}
      />
    </>
  );
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
