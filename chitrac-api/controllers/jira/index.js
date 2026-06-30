const express = require("express");
const jwt = require("jsonwebtoken");

module.exports = function (server) {
  const router = express.Router();
  const config = server.config;
  const logger = server.logger;

  function extractToken(req) {
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7).trim();
    if (typeof req.query?.token === "string") return req.query.token;
    if (typeof req.body?.token === "string") return req.body.token;
    return null;
  }

  function requireLoggedIn(req, res, next) {
    if (config.enableApiTokenCheck === false) {
      req.authUser = { username: "auth-disabled" };
      return next();
    }

    try {
      const token = extractToken(req);
      if (!token) return res.status(401).json({ error: "Missing token" });

      const payload = jwt.verify(token, config.jwtSecret);
      req.authUser = {
        id: payload.userId,
        username: payload.username,
        role: payload.role,
        permissions: payload.permissions
      };
      return next();
    } catch (error) {
      return res.status(401).json({ error: "Invalid token" });
    }
  }

  function assertJiraConfig() {
    const missing = [];
    if (!config.jira?.baseUrl) missing.push("JIRA_BASE_URL");
    if (!config.jira?.email) missing.push("JIRA_EMAIL");
    if (!config.jira?.apiToken) missing.push("JIRA_API_TOKEN");
    if (!config.jira?.projectKey) missing.push("JIRA_PROJECT_KEY");
    if (!config.jira?.issueTypeId) missing.push("JIRA_ISSUE_TYPE_ID");
    if (!config.jira?.issueTypeName) missing.push("JIRA_ISSUE_TYPE_NAME");

    if (missing.length) {
      const error = new Error(`Jira is not configured: ${missing.join(", ")}`);
      error.status = 500;
      throw error;
    }
  }

  function sanitizeText(value, fallback = "") {
    if (value === null || value === undefined) return fallback;
    return String(value).trim() || fallback;
  }

  function truncate(value, maxLength) {
    const text = sanitizeText(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 3)}...`;
  }

  function stripHtml(value) {
    return sanitizeText(value)
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'");
  }

  function normalizeSingleLine(value) {
    return stripHtml(value).replace(/\s+/g, " ").trim();
  }

  function stringifyDetails(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;

    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return String(value);
    }
  }

  function adfParagraph(text) {
    return {
      type: "paragraph",
      content: [{ type: "text", text: sanitizeText(text, "Not provided") }]
    };
  }

  function adfHeading(text) {
    return {
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text }]
    };
  }

  function adfCodeBlock(text) {
    return {
      type: "codeBlock",
      attrs: { language: "json" },
      content: [{ type: "text", text: sanitizeText(text, "Not provided") }]
    };
  }

  function buildDescription({ body, reporter }) {
    const timestamp = sanitizeText(body.timestamp, new Date().toISOString());
    const serverName = config.systemName || "ChiTrac";
    const details = stringifyDetails(body.fullError);

    return {
      type: "doc",
      version: 1,
      content: [
        adfParagraph("This bug was automatically reported from the ChiTrac error modal."),
        adfHeading("Context"),
        adfParagraph(`Server: ${serverName}`),
        adfParagraph(`Reported by: ${reporter.username || body.user?.username || "Unknown user"}`),
        adfParagraph(`Timestamp: ${timestamp}`),
        adfParagraph(`Page URL: ${sanitizeText(body.pageUrl, "Not provided")}`),
        adfParagraph(`Endpoint: ${sanitizeText(body.endpoint, "Not provided")}`),
        adfParagraph(`Status code: ${sanitizeText(body.statusCode, "Not provided")}`),
        adfHeading("Error Message"),
        adfParagraph(sanitizeText(body.message || body.errorMessage, "No error message provided")),
        adfHeading("Technical Details"),
        adfCodeBlock(details || "No additional technical details provided."),
        adfHeading("Browser"),
        adfParagraph(sanitizeText(body.userAgent, "Not provided"))
      ]
    };
  }

  function buildSummary(body) {
    const serverName = config.systemName || "ChiTrac";
    let statusLabel = "Unknown Error";

    if (body.statusCode === 0 || body.statusCode === "0") {
      statusLabel = "Network Error";
    } else if (body.statusCode) {
      statusLabel = `HTTP ${body.statusCode}`;
    }

    return truncate(normalizeSingleLine(`ChiTrac Error - ${serverName} - ${statusLabel}`), 255);
  }

  function escapeJqlString(value) {
    return sanitizeText(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  async function jiraRequest(path, options = {}) {
    const baseUrl = config.jira.baseUrl.replace(/\/+$/, "");
    const authValue = Buffer
      .from(`${config.jira.email}:${config.jira.apiToken}`)
      .toString("base64");

    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method || "GET",
      headers: {
        "Authorization": `Basic ${authValue}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const responseText = await response.text();
    let responseBody = null;
    if (responseText) {
      try {
        responseBody = JSON.parse(responseText);
      } catch (error) {
        responseBody = { message: responseText };
      }
    }

    if (!response.ok) {
      const message = responseBody?.errorMessages?.join("; ")
        || Object.values(responseBody?.errors || {}).join("; ")
        || responseBody?.message
        || `Jira returned HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.details = responseBody;
      throw error;
    }

    return responseBody;
  }

  async function searchExistingIssue(summary) {
    const projectKey = escapeJqlString(config.jira.projectKey);
    const issueTypeName = escapeJqlString(config.jira.issueTypeName);
    const summaryPhrase = escapeJqlString(summary);
    const autoReportedLabel = (config.jira.labels || []).includes("auto-reported")
      ? ' AND labels = "auto-reported"'
      : "";
    const jql = `project = "${projectKey}" AND issuetype = "${issueTypeName}" AND resolution = Unresolved${autoReportedLabel} AND summary ~ "\\"${summaryPhrase}\\"" ORDER BY created DESC`;

    const searchResult = await jiraRequest("/rest/api/3/search/jql", {
      method: "POST",
      body: {
        jql,
        maxResults: 10,
        fields: ["summary", "status"]
      }
    });

    return (searchResult?.issues || []).find((issue) => issue?.fields?.summary === summary) || null;
  }

  async function createJiraIssue(issuePayload) {
    return jiraRequest("/rest/api/3/issue", {
      method: "POST",
      body: issuePayload
    });
  }

  async function addJiraComment(issueKey, commentBody) {
    return jiraRequest(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
      method: "POST",
      body: { body: commentBody }
    });
  }

  router.post("/report-bug", requireLoggedIn, async (req, res) => {
    try {
      assertJiraConfig();

      const message = sanitizeText(req.body?.message || req.body?.errorMessage);
      if (!message) {
        return res.status(400).json({ error: "Error message is required" });
      }

      const summary = buildSummary(req.body);
      const existingIssue = await searchExistingIssue(summary);
      const baseUrl = config.jira.baseUrl.replace(/\/+$/, "");

      if (existingIssue?.key) {
        await addJiraComment(
          existingIssue.key,
          buildDescription({ body: req.body, reporter: req.authUser || {} })
        );

        return res.status(200).json({
          success: true,
          action: "commented",
          key: existingIssue.key,
          id: existingIssue.id,
          url: `${baseUrl}/browse/${existingIssue.key}`
        });
      }

      const issuePayload = {
        fields: {
          project: { key: config.jira.projectKey },
          issuetype: { id: config.jira.issueTypeId },
          summary,
          description: buildDescription({ body: req.body, reporter: req.authUser || {} }),
          labels: config.jira.labels || []
        }
      };

      if (config.jira.defaultPriority) {
        issuePayload.fields.priority = { name: config.jira.defaultPriority };
      }

      const jiraIssue = await createJiraIssue(issuePayload);

      return res.status(201).json({
        success: true,
        action: "created",
        key: jiraIssue.key,
        id: jiraIssue.id,
        url: `${baseUrl}/browse/${jiraIssue.key}`
      });
    } catch (error) {
      logger?.error?.("Failed to create Jira bug report:", {
        message: error.message,
        status: error.status,
        details: error.details
      });

      return res.status(error.status || 500).json({
        success: false,
        error: error.message || "Failed to create Jira bug report"
      });
    }
  });

  return router;
};
