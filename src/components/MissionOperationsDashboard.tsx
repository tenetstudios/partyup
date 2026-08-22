import { StyleSheet, Text, View } from "react-native";
import type { MissionOperationsDashboard as DashboardData } from "../../lib/roomMissions";

const statusCopy: Record<DashboardData["operational_status"], { label: string; detail: string; warning?: boolean }> = {
  healthy: { label: "HEALTHY", detail: "Groups are balanced and currently have enough members." },
  waiting_for_participants: { label: "WAITING", detail: "No participant activity has been recorded yet." },
  needs_people: { label: "NEEDS PEOPLE", detail: "At least one group does not have enough members for everyone to finish.", warning: true },
  imbalanced: { label: "IMBALANCED", detail: "The largest and smallest groups differ by more than one participant.", warning: true },
  ended: { label: "ENDED", detail: "Historical results are read-only." },
};

export default function MissionOperationsDashboard({ dashboard }: { dashboard: DashboardData }) {
  const status = statusCopy[dashboard.operational_status];
  const largestGroup = Math.max(1, ...dashboard.groups.map((group) => group.participant_count));

  return (
    <View style={styles.panel}>
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.eyebrow}>MISSION OPERATIONS</Text>
          <Text style={styles.updated}>Updated {new Date(dashboard.generated_at).toLocaleTimeString()}</Text>
        </View>
        <View style={[styles.status, status.warning && styles.statusWarning]}>
          <Text style={[styles.statusText, status.warning && styles.statusWarningText]}>{status.label}</Text>
        </View>
      </View>
      <Text style={styles.detail}>{status.detail}</Text>

      <View style={styles.metrics}>
        <Metric label="Participants" value={dashboard.summary.participant_count} />
        <Metric label="Completed" value={dashboard.summary.completed_count} />
        <Metric label="Completion" value={`${dashboard.summary.completion_rate}%`} />
        <Metric label="Encounters" value={dashboard.summary.encounter_count} />
      </View>

      {dashboard.groups.length > 0 && (
        <View style={styles.groups}>
          <Text style={styles.groupsTitle}>GROUPS</Text>
          <Text style={styles.groupsMeta}>
            Spread {dashboard.summary.assignment_spread}
            {dashboard.minimum_group_size ? ` · Minimum ${dashboard.minimum_group_size} per group` : ""}
          </Text>
          {dashboard.groups.map((group) => (
            <View key={group.assignment_key} style={styles.groupCard}>
              <View style={styles.groupHeading}>
                <View style={styles.groupName}>
                  <View style={[styles.dot, group.color ? { backgroundColor: group.color } : null]} />
                  <Text style={styles.groupLabel} numberOfLines={1}>{group.label}</Text>
                  {group.underfilled && <Text style={styles.underfilled}>UNDERFILLED</Text>}
                </View>
                <Text style={styles.groupCount}>{group.participant_count}</Text>
              </View>
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    group.color ? { backgroundColor: group.color } : null,
                    { width: `${Math.max(group.participant_count > 0 ? 4 : 0, (group.participant_count / largestGroup) * 100)}%` },
                  ]}
                />
              </View>
              <Text style={styles.groupMeta}>{group.completed_count} completed · {group.encounter_count} encounters</Text>
            </View>
          ))}
        </View>
      )}

      {dashboard.summary.unassigned_participant_count > 0 && (
        <Text style={styles.unassigned}>
          {dashboard.summary.unassigned_participant_count} known participant{dashboard.summary.unassigned_participant_count === 1 ? "" : "s"} currently lack a group assignment.
        </Text>
      )}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#050509", borderColor: "rgba(255,255,255,0.1)", borderRadius: 8, borderWidth: 1, marginTop: 14, padding: 14 },
  headingRow: { alignItems: "flex-start", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  eyebrow: { color: "#D8B4FE", fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  updated: { color: "#71717A", fontSize: 10, marginTop: 4 },
  status: { backgroundColor: "rgba(6,78,59,0.45)", borderColor: "rgba(52,211,153,0.35)", borderRadius: 6, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 6 },
  statusWarning: { backgroundColor: "rgba(120,53,15,0.35)", borderColor: "rgba(252,211,77,0.35)" },
  statusText: { color: "#A7F3D0", fontSize: 10, fontWeight: "900" },
  statusWarningText: { color: "#FEF3C7" },
  detail: { color: "#D4D4D8", fontSize: 12, lineHeight: 18, marginTop: 10 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  metric: { backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 7, minWidth: "47%", padding: 10 },
  metricLabel: { color: "#71717A", fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  metricValue: { color: "#FFFFFF", fontSize: 19, fontWeight: "900", marginTop: 3 },
  groups: { borderTopColor: "rgba(255,255,255,0.1)", borderTopWidth: 1, marginTop: 14, paddingTop: 12 },
  groupsTitle: { color: "#D4D4D8", fontSize: 11, fontWeight: "900" },
  groupsMeta: { color: "#71717A", fontSize: 10, marginTop: 3 },
  groupCard: { backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 7, marginTop: 9, padding: 10 },
  groupHeading: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  groupName: { alignItems: "center", flex: 1, flexDirection: "row", gap: 7, minWidth: 0 },
  dot: { backgroundColor: "#A855F7", borderRadius: 6, height: 11, width: 11 },
  groupLabel: { color: "#FFFFFF", flexShrink: 1, fontSize: 13, fontWeight: "900" },
  groupCount: { color: "#E4E4E7", fontSize: 13, fontWeight: "900" },
  underfilled: { backgroundColor: "rgba(120,53,15,0.7)", borderRadius: 4, color: "#FEF3C7", fontSize: 8, fontWeight: "900", overflow: "hidden", paddingHorizontal: 5, paddingVertical: 3 },
  track: { backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 4, height: 7, marginTop: 8, overflow: "hidden" },
  fill: { backgroundColor: "#A855F7", borderRadius: 4, height: "100%" },
  groupMeta: { color: "#71717A", fontSize: 10, marginTop: 7 },
  unassigned: { color: "#FDE68A", fontSize: 11, fontWeight: "800", lineHeight: 16, marginTop: 11 },
});
