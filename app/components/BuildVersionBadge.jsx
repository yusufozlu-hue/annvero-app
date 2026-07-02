import { getBuildInfo } from "@/src/lib/buildInfo";

export default function BuildVersionBadge({ className = "" }) {
  const build = getBuildInfo();

  return (
    <p
      className={`text-xs text-gray-500 ${className}`}
      title={`Commit: ${build.fullCommit}\nBuild: ${build.builtAt}`}
    >
      {build.label}
    </p>
  );
}
