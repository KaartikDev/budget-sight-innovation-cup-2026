export const WORKLOAD_TYPES = [
  "code_generation",
  "debugging",
  "testing",
  "repo_exploration",
  "web_research",
  "artifact_generation",
  "environment_setup",
  "deployment_operations",
  "analysis_planning",
  "other",
  "unknown",
];

// Tool/action labels also appear throughout reporting and are useful radar
// axes when users want to inspect operational work such as file reading.
export const ACTION_TYPES = [
  "repo_exploration",
  "code_search",
  "file_reading",
  "code_editing",
  "test_validation",
  "command_execution",
  "environment_inspection",
  "dependency_setup",
  "web_searching",
  "version_control",
  "artifact_inspection",
  "other",
];
