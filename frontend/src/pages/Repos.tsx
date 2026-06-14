import { useState } from "react";
import { RepoList } from "@/components/repo/RepoList";
import { AddRepoDialog } from "@/components/repo/AddRepoDialog";
import { Header } from "@/components/ui/header";
import { Button } from "@/components/ui/button";
import { Plus, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PendingActionsGroup } from "@/components/notifications/PendingActionsGroup";
import { useSidebarAction } from "@/hooks/useSidebarAction";

export function Repos() {
  const navigate = useNavigate();
  const [addRepoOpen, setAddRepoOpen] = useState(false);

  useSidebarAction('new-repo', () => {
    setAddRepoOpen(true);
  });

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col">
      <Header>
        <div className="flex items-center gap-3">
          <Header.Title logo>OpenCode</Header.Title>
        </div>
        <Header.Actions>
          <div className="flex items-center gap-1">
            <PendingActionsGroup />
          </div>
          <Button onClick={() => setAddRepoOpen(true)} size="sm">
            <Plus className="w-4 h-4 mr-1" />
            Repo
          </Button>
        </Header.Actions>
      </Header>
      <div className="container mx-auto flex-1 pt-2 px-2 min-h-0 overflow-auto pb-[calc(env(safe-area-inset-bottom)+60px)] sm:pb-0">

        <RepoList />
      </div>
      <AddRepoDialog open={addRepoOpen} onOpenChange={setAddRepoOpen} />
    </div>
  );
}
