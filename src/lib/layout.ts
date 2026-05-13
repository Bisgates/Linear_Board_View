import type { IssueRecord } from "../linear/types";

export interface XY {
  x: number;
  y: number;
}

const COL_W = 290;
const ROW_H = 132;
const MAX_COLS_PER_PROJECT = 3;
const PROJECT_ROW_GAP = 12;
const TEAM_GAP_X = 60;

/**
 * Default layout — teams as horizontally adjacent column blocks; inside each
 * team, every project occupies one row of cards laid out left-to-right. No
 * labels, no decorations: grouping is read straight from spatial separation
 * plus each card's project-color border.
 */
export function computeInitialLayout(issues: IssueRecord[]): Record<string, XY> {
  const teams = new Map<
    string,
    {
      name: string;
      projects: Map<string, { name: string; issues: IssueRecord[] }>;
    }
  >();

  for (const iss of issues) {
    const teamKey = iss.team?.id ?? "__no_team";
    const teamName = iss.team?.name ?? "No team";
    const projectKey = iss.project?.id ?? "__no_project";
    const projectName = iss.project?.name ?? "No project";

    if (!teams.has(teamKey)) {
      teams.set(teamKey, { name: teamName, projects: new Map() });
    }
    const team = teams.get(teamKey)!;
    if (!team.projects.has(projectKey)) {
      team.projects.set(projectKey, { name: projectName, issues: [] });
    }
    team.projects.get(projectKey)!.issues.push(iss);
  }

  const orderedTeams = Array.from(teams.entries()).sort(([keyA, ta], [keyB, tb]) => {
    if (keyA === "__no_team") return 1;
    if (keyB === "__no_team") return -1;
    return ta.name.localeCompare(tb.name);
  });

  const positions: Record<string, XY> = {};
  let currentX = 0;

  for (const [, team] of orderedTeams) {
    const orderedProjects = Array.from(team.projects.entries()).sort(
      ([keyA, pa], [keyB, pb]) => {
        if (keyA === "__no_project") return 1;
        if (keyB === "__no_project") return -1;
        return pa.name.localeCompare(pb.name);
      },
    );

    let currentY = 0;

    for (const [, project] of orderedProjects) {
      project.issues.forEach((iss, i) => {
        const col = i % MAX_COLS_PER_PROJECT;
        const row = Math.floor(i / MAX_COLS_PER_PROJECT);
        positions[iss.id] = {
          x: currentX + col * COL_W,
          y: currentY + row * ROW_H,
        };
      });
      const rowCount = Math.max(1, Math.ceil(project.issues.length / MAX_COLS_PER_PROJECT));
      currentY += rowCount * ROW_H + PROJECT_ROW_GAP;
    }

    const teamWidth = MAX_COLS_PER_PROJECT * COL_W;
    currentX += teamWidth + TEAM_GAP_X;
  }

  return positions;
}
