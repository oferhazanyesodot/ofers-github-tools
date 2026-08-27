import { githubFetch } from "./github-transport.js";

export async function revertFileInPR({ owner, repo, baseBranch, headBranch, filePath, status }) {
  const repoBase = `https://github.com/${owner}/${repo}`;

  if (status === "added") {
    await deleteFileViaWeb(repoBase, headBranch, filePath);
    return { action: "deleted", filePath };
  }

  if (status === "removed") {
    const baseContent = await getFileContent(repoBase, baseBranch, filePath);
    await createFileViaWeb(repoBase, headBranch, filePath, baseContent);
    return { action: "restored", filePath };
  }

  const baseContent = await getFileContent(repoBase, baseBranch, filePath);
  await updateFileViaWeb(repoBase, headBranch, filePath, baseContent);
  return { action: "reverted", filePath };
}

async function getFileContent(repoBase, branch, filePath) {
  const response = await githubFetch(`${repoBase}/raw/${branch}/${filePath}`);
  if (!response.ok) throw new Error(`Could not fetch file from ${branch}: ${response.status}`);
  return response.text();
}

async function updateFileViaWeb(repoBase, branch, filePath, newContent) {
  const editPage = await githubFetch(`${repoBase}/edit/${branch}/${filePath}`, { headers: { Accept: "text/html" } });
  if (!editPage.ok) throw new Error(`Could not load edit page: ${editPage.status}`);
  const formData = extractEditFormData(await editPage.text(), `${repoBase}/tree-save/${branch}/${filePath}`);
  if (!formData.authenticity_token) throw new Error("Could not extract CSRF token. Are you logged in with write access?");

  const body = new URLSearchParams({
    authenticity_token: formData.authenticity_token,
    filename: filePath,
    new_filename: filePath,
    content_changed: "true",
    value: newContent,
    message: `Revert "${filePath}" — restore to base branch version`,
    placeholder_message: "",
    description: "",
    commit_choice: "direct",
    target_branch: branch,
    quick_pull: "",
    ...(formData.commit && { commit: formData.commit }),
  });
  const response = await githubFetch(`${repoBase}/tree-save/${branch}/${filePath}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (response.status === 422) throw new Error(`Edit submission failed: 422`);
}

async function deleteFileViaWeb(repoBase, branch, filePath) {
  const response = await githubFetch(`${repoBase}/delete/${branch}/${filePath}`);
  if (!response.ok) throw new Error(`Could not load delete page: ${response.status}`);
  const formData = extractEditFormData(await response.text());
  if (!formData.authenticity_token) throw new Error("Could not extract CSRF token. Are you logged in with write access?");

  const body = new URLSearchParams({
    authenticity_token: formData.authenticity_token,
    filename: filePath.split("/").pop(),
    message: `Revert "${filePath}" — remove file added in PR`,
    placeholder_message: "",
    description: "",
    commit_choice: "direct",
    target_branch: branch,
    quick_pull: "",
    ...(formData.commit && { commit: formData.commit }),
  });
  const submit = await githubFetch(`${repoBase}/tree-save/${branch}/${filePath}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!submit.ok && submit.status !== 302 && submit.status !== 303) throw new Error(`Delete submission failed: ${submit.status}`);
}

async function createFileViaWeb(repoBase, branch, filePath, content) {
  const dirPath = filePath.includes("/") ? filePath.substring(0, filePath.lastIndexOf("/")) : "";
  const newFilePage = await githubFetch(dirPath ? `${repoBase}/new/${branch}/${dirPath}` : `${repoBase}/new/${branch}`);
  if (!newFilePage.ok) throw new Error(`Could not load new file page: ${newFilePage.status}`);
  const formData = extractEditFormData(await newFilePage.text());
  if (!formData.authenticity_token) throw new Error("Could not extract CSRF token. Are you logged in with write access?");

  const fileName = filePath.split("/").pop();
  const submitUrl = dirPath ? `${repoBase}/tree-save/${branch}/${dirPath}` : `${repoBase}/tree-save/${branch}`;
  const body = new URLSearchParams({
    authenticity_token: formData.authenticity_token,
    filename: fileName,
    new_filename: fileName,
    content_changed: "true",
    value: content,
    message: `Revert "${filePath}" — restore deleted file`,
    placeholder_message: "",
    description: "",
    commit_choice: "direct",
    target_branch: branch,
    quick_pull: "",
    ...(formData.commit && { commit: formData.commit }),
  });
  const submit = await githubFetch(submitUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!submit.ok && submit.status !== 302 && submit.status !== 303) throw new Error(`Create submission failed: ${submit.status}`);
}

function extractEditFormData(html, submitPath) {
  const data = {};
  const csrfJsonMatch = html.match(/"csrf_tokens"\s*:\s*\{([^}]+\}[^}]*)\}/);
  if (csrfJsonMatch) {
    try {
      const tokens = JSON.parse(`{${csrfJsonMatch[1]}}`);
      for (const [path, methods] of Object.entries(tokens)) {
        if (methods.post && (!submitPath || path.includes(submitPath.replace("https://github.com", "")))) {
          data.authenticity_token = methods.post;
          break;
        }
        if (methods.post && !data.authenticity_token) data.authenticity_token = methods.post;
      }
    } catch {
      const tokenFromJson = html.match(/"csrf_tokens"[^}]*"post"\s*:\s*"([^"]+)"/);
      if (tokenFromJson) data.authenticity_token = tokenFromJson[1];
    }
  }

  if (!data.authenticity_token) {
    const tokenMatch = html.match(/name="authenticity_token"\s+value="([^"]+)"/) ||
      html.match(/value="([^"]+)"\s+name="authenticity_token"/) ||
      html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/) ||
      html.match(/<meta\s+content="([^"]+)"\s+name="csrf-token"/) ||
      html.match(/"post"\s*:\s*"([A-Za-z0-9_-]{20,})"/);
    if (tokenMatch) data.authenticity_token = tokenMatch[1];
  }

  const oidMatch = html.match(/"commitOid"\s*:\s*"([a-f0-9]{40})"/) ||
    html.match(/"commit_oid"\s*:\s*"([a-f0-9]{40})"/) ||
    html.match(/"sha"\s*:\s*"([a-f0-9]{40})"/) ||
    html.match(/"headOid"\s*:\s*"([a-f0-9]{40})"/);
  if (oidMatch) data.commit = oidMatch[1];
  if (!data.commit) {
    const commitMatch = html.match(/name="commit"\s+value="([a-f0-9]{40})"/) || html.match(/value="([a-f0-9]{40})"\s+name="commit"/);
    if (commitMatch) data.commit = commitMatch[1];
  }
  if (!data.commit) {
    const dataCommit = html.match(/data-commit-oid="([a-f0-9]{40})"/) || html.match(/data-blob-commit-oid="([a-f0-9]{40})"/);
    if (dataCommit) data.commit = dataCommit[1];
  }
  if (!data.commit) {
    const nearCommit = html.match(/commit[^"]*"([a-f0-9]{40})"/);
    if (nearCommit) data.commit = nearCommit[1];
  }
  return data;
}
