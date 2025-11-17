(() => {
  if (window.__tr_json2zwo_initialized) return;
  window.__tr_json2zwo_initialized = true;

  const BASE_URL = "https://www.trainerroad.com";
  const WORKOUT_REGEX = /\/app\/cycling\/workouts\/add\/(\d+)/;
  let lastProcessedWorkoutId = null;

  // ---------- Messaging: handle icon click ----------

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
      if (msg && msg.type === "TR2ZWO_DOWNLOAD") {
        generateZwoForCurrentPage(true); // true = trigger download
      }
    });
  }

  // ---------- Fetch helper with required header ----------

  async function fetchJson(url) {
    const res = await fetch(url, {
      credentials: "include",
      headers: {
        "trainerroad-jsonformat": "camel-case"
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return res.json();
  }

  // ---------- URL / SPA watcher using History API ----------

  function getWorkoutIdFromLocation() {
    const m = window.location.pathname.match(WORKOUT_REGEX);
    return m ? m[1] : null;
  }

  function onUrlChange() {
    const workoutId = getWorkoutIdFromLocation();
    if (!workoutId) return;

    if (workoutId === lastProcessedWorkoutId) {
      return;
    }

    lastProcessedWorkoutId = workoutId;
    console.log("[TR2ZWO] Detected TrainerRoad workout ID:", workoutId);
    generateZwoForCurrentPage(false); // false = just log, no auto-download
  }

  function installSpaUrlListener() {
    if (window.__tr_json2zwo_url_listener_installed) return;
    window.__tr_json2zwo_url_listener_installed = true;

    let lastHref = location.href;

    const handleIfChanged = () => {
      const current = location.href;
      if (current === lastHref) return;
      lastHref = current;
      onUrlChange();
    };

    const origPushState = history.pushState;
    history.pushState = function (...args) {
      const ret = origPushState.apply(this, args);
      handleIfChanged();
      return ret;
    };

    const origReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      const ret = origReplaceState.apply(this, args);
      handleIfChanged();
      return ret;
    };

    window.addEventListener("popstate", handleIfChanged);
    setInterval(handleIfChanged, 1500);
  }

  installSpaUrlListener();
  onUrlChange();

  // ---------- Helpers to read chart-data points ----------

  function getSeconds(pt) {
    if (typeof pt.Seconds === "number") return pt.Seconds;
    if (typeof pt.seconds === "number") return pt.seconds;
    if (typeof pt.time === "number") return pt.time;
    return 0;
  }

  function getFtpPercent(pt) {
    if (typeof pt.FtpPercent === "number") return pt.FtpPercent;
    if (typeof pt.ftpPercent === "number") return pt.ftpPercent;
    if (typeof pt.MemberFtpPercent === "number") return pt.MemberFtpPercent;
    if (typeof pt.memberFtpPercent === "number") return pt.memberFtpPercent;
    return 0;
  }

  // ---------- Ramp & intervals helpers ----------

  function buildSamples(courseData) {
    const sorted = [...courseData].sort(
      (a, b) => getSeconds(a) - getSeconds(b)
    );
    const samples = [];
    for (const pt of sorted) {
      const t = getSeconds(pt) / 1000;
      const p = getFtpPercent(pt) / 100;
      if (!Number.isFinite(t)) continue;

      if (
        samples.length > 0 &&
        Math.abs(t - samples[samples.length - 1].t) < 1e-6
      ) {
        samples[samples.length - 1].p = p;
      } else {
        samples.push({t, p});
      }
    }
    return samples;
  }

  function buildBlocks(samples) {
    /**
     * kind: 'steady' | 'rampUp' | 'rampDown'
     * steady:  { kind, duration, power }
     * rampUp:  { kind, duration, powerLow, powerHigh }
     * rampDown:{ kind, duration, powerLow, powerHigh }
     *
     * Any ramp with duration <= 1s is treated as an instantaneous step:
     * - no separate block
     * - its time is added to the next block.
     */
    if (!samples || samples.length < 2) return [];

    const blocks = [];
    const EPS_POWER = 1e-4;
    const MIN_RAMP_DURATION_SEC = 1.0 + 1e-6;
    let carryToNext = 0;

    let i = 0;
    while (i < samples.length - 1) {
      let tStart = samples[i].t;
      let pStart = samples[i].p;

      let dt = samples[i + 1].t - samples[i].t;
      if (dt <= 0) {
        i++;
        continue;
      }

      let dp = samples[i + 1].p - samples[i].p;
      let baseKind;
      if (Math.abs(dp) <= EPS_POWER) baseKind = "steady";
      else if (dp > 0) baseKind = "rampUp";
      else baseKind = "rampDown";

      let j = i + 1;

      while (j < samples.length - 1) {
        const dt2 = samples[j + 1].t - samples[j].t;
        if (dt2 <= 0) {
          j++;
          continue;
        }
        const dp2 = samples[j + 1].p - samples[j].p;
        let kind2;
        if (Math.abs(dp2) <= EPS_POWER) kind2 = "steady";
        else if (dp2 > 0) kind2 = "rampUp";
        else kind2 = "rampDown";

        if (kind2 !== baseKind) break;
        j++;
      }

      const tEnd = samples[j].t;
      const pEnd = samples[j].p;
      let duration = tEnd - tStart;

      if (duration > 0) {
        if (baseKind !== "steady" && duration <= MIN_RAMP_DURATION_SEC) {
          carryToNext += duration;
        } else {
          duration += carryToNext;
          carryToNext = 0;

          if (baseKind === "steady") {
            blocks.push({
              kind: "steady",
              duration,
              power: pStart
            });
          } else if (baseKind === "rampUp") {
            blocks.push({
              kind: "rampUp",
              duration,
              powerLow: pStart,
              powerHigh: pEnd
            });
          } else if (baseKind === "rampDown") {
            blocks.push({
              kind: "rampDown",
              duration,
              powerLow: pStart,
              powerHigh: pEnd
            });
          }
        }
      }

      i = j;
    }

    if (carryToNext > 0 && blocks.length > 0) {
      blocks[blocks.length - 1].duration += carryToNext;
    }

    return blocks;
  }

  function almostEqual(a, b, tol) {
    return Math.abs(a - b) <= tol;
  }

  function blocksSimilar(a, b, durTolSec, powTol) {
    if (a.kind !== b.kind) return false;
    if (!almostEqual(a.duration, b.duration, durTolSec)) return false;
    if (a.kind === "steady") {
      return almostEqual(a.power, b.power, powTol);
    }
    if (a.kind === "rampUp" || a.kind === "rampDown") {
      return (
        almostEqual(a.powerLow, b.powerLow, powTol) &&
        almostEqual(a.powerHigh, b.powerHigh, powTol)
      );
    }
    return false;
  }

  function compressToXmlBlocks(blocks) {
    const xmlBlocks = [];
    const DUR_TOL = 1;
    const PWR_TOL = 0.01;

    let i = 0;
    while (i < blocks.length) {
      // Try to detect IntervalsT: [on, off] repeated >= 2 times
      if (i + 3 < blocks.length) {
        const on1 = blocks[i];
        const off1 = blocks[i + 1];

        if (off1.kind === "steady") {
          let repeat = 1;
          let j = i + 2;

          while (j + 1 < blocks.length) {
            const onNext = blocks[j];
            const offNext = blocks[j + 1];
            if (
              !blocksSimilar(on1, onNext, DUR_TOL, PWR_TOL) ||
              !blocksSimilar(off1, offNext, DUR_TOL, PWR_TOL)
            ) {
              break;
            }
            repeat++;
            j += 2;
          }

          if (repeat >= 2) {
            const onDur = Math.round(on1.duration);
            const offDur = Math.round(off1.duration);
            const offPower = off1.power;

            let xmlBlock;
            if (on1.kind === "steady") {
              xmlBlock = {
                type: "IntervalsT",
                attrs: {
                  Repeat: String(repeat),
                  OnDuration: String(onDur),
                  OffDuration: String(offDur),
                  PowerOnLow: on1.power.toFixed(3),
                  PowerOnHigh: on1.power.toFixed(3),
                  PowerOff: offPower.toFixed(3)
                }
              };
            } else if (on1.kind === "rampUp") {
              xmlBlock = {
                type: "IntervalsT",
                attrs: {
                  Repeat: String(repeat),
                  OnDuration: String(onDur),
                  OffDuration: String(offDur),
                  PowerOnLow: on1.powerLow.toFixed(3),
                  PowerOnHigh: on1.powerHigh.toFixed(3),
                  PowerOff: offPower.toFixed(3)
                }
              };
            } else if (on1.kind === "rampDown") {
              // ramp-down inside IntervalsT: start high -> end low
              xmlBlock = {
                type: "IntervalsT",
                attrs: {
                  Repeat: String(repeat),
                  OnDuration: String(onDur),
                  OffDuration: String(offDur),
                  PowerOnLow: on1.powerLow.toFixed(3),
                  PowerOnHigh: on1.powerHigh.toFixed(3),
                  PowerOff: offPower.toFixed(3)
                }
              };
            }

            xmlBlocks.push(xmlBlock);
            i += repeat * 2;
            continue;
          }
        }
      }

      const b = blocks[i];
      if (b.kind === "steady") {
        xmlBlocks.push({
          type: "SteadyState",
          attrs: {
            Duration: String(Math.round(b.duration)),
            Power: b.power.toFixed(3)
          }
        });
      } else if (b.kind === "rampUp") {
        xmlBlocks.push({
          type: "Warmup",
          attrs: {
            Duration: String(Math.round(b.duration)),
            PowerLow: b.powerLow.toFixed(3),
            PowerHigh: b.powerHigh.toFixed(3)
          }
        });
      } else if (b.kind === "rampDown") {
        xmlBlocks.push({
          type: "Cooldown",
          attrs: {
            Duration: String(Math.round(b.duration)),
            PowerLow: b.powerLow.toFixed(3),   // start (higher)
            PowerHigh: b.powerHigh.toFixed(3)  // end (lower)
          }
        });
      }
      i++;
    }

    return xmlBlocks;
  }

  // ---------- ZWO generation ----------

  function cdataWrap(str) {
    if (!str) return "<![CDATA[]]>";
    const safe = String(str).replace("]]>", "]]&gt;");
    return `<![CDATA[${safe}]]>`;
  }

  function buildCategory(summary) {
    let category = "Uncategorized";

    if (
      summary &&
      summary.progression &&
      summary.progression.text &&
      typeof summary.progressionLevel === "number"
    ) {
      category = `${summary.progression.text} ${summary.progressionLevel.toFixed(
        2
      )}`;
    } else if (summary && summary.progression && summary.progression.text) {
      category = summary.progression.text;
    }

    return category;
  }

  function toZwoXml(courseData, summary) {
    const samples = buildSamples(courseData);
    const blocks = buildBlocks(samples);
    const xmlBlocks = compressToXmlBlocks(blocks);

    const category = buildCategory(summary);

    const name =
      (summary && summary.workoutName) ||
      `TrainerRoad Workout ${summary && summary.id}`;

    const tss = summary && typeof summary.tss === "number" ? summary.tss : null;
    const kj = summary && typeof summary.kj === "number" ? summary.kj : null;
    const intensityFactorRaw =
      summary && typeof summary.intensityFactor === "number"
        ? summary.intensityFactor
        : null;
    const intensityFactor =
      intensityFactorRaw != null
        ? intensityFactorRaw > 1
          ? intensityFactorRaw / 100
          : intensityFactorRaw
        : null;

    let description =
      (summary && summary.workoutDescription) ||
      (summary && summary.goalDescription) ||
      "Converted from TrainerRoad.";

    const metrics = [];
    if (tss != null) metrics.push(`TSS: ${tss}`);
    if (kj != null) metrics.push(`kJ: ${kj}`);
    if (intensityFactor != null)
      metrics.push(`IF: ${intensityFactor.toFixed(2)}`);

    if (metrics.length > 0) {
      description += `\n\nMetrics: ${metrics.join(", ")}`;
    }

    const tags = [];
    tags.push({name: "TrainerRoad"});
    tags.push({name: category});
    if (tss != null) tags.push({name: `TSS ${tss}`});
    if (kj != null) tags.push({name: `kJ ${kj}`});
    if (intensityFactor != null)
      tags.push({name: `IF ${intensityFactor.toFixed(2)}`});

    const blocksXml = xmlBlocks
      .map((b) => {
        const attrs = Object.entries(b.attrs)
          .map(([k, v]) => `${k}="${v}"`)
          .join(" ");
        return `    <${b.type} ${attrs} />`;
      })
      .join("\n");

    const tagsXml = tags
      .map((t) => `  <tag name="${t.name}"/>`)
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  <author>TrainerRoad json2zwo</author>
  <name>${name}</name>
  <description>${cdataWrap(description)}</description>
  <category>${category}</category>
  <sportType>bike</sportType>
  <tags>
${tagsXml}
  </tags>
  <workout>
${blocksXml}
  </workout>
</workout_file>`;

    return xml;
  }

  // ---------- Download helper ----------

  function downloadZwo(zwoXml, filename) {
    const blob = new Blob([zwoXml], {type: "application/xml"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------- Main generator ----------

  async function generateZwoForCurrentPage(shouldDownload) {
    const workoutIdMatch = window.location.pathname.match(WORKOUT_REGEX);
    if (!workoutIdMatch) {
      console.error("[TR2ZWO] Not on a TrainerRoad workout add page.");
      return;
    }
    const workoutId = workoutIdMatch[1];

    try {
      const chartUrl = `${BASE_URL}/app/api/workouts/${workoutId}/chart-data`;
      const summaryUrl = `${BASE_URL}/app/api/workouts/${workoutId}/summary?withDifficultyRating=true`;

      console.log("[TR2ZWO] Fetching chart data:", chartUrl);
      const chartData = await fetchJson(chartUrl);

      console.log("[TR2ZWO] Fetching metadata:", summaryUrl);
      const metaResp = await fetchJson(summaryUrl);
      const summary = metaResp.summary || metaResp;

      let courseData =
        chartData.CourseData || chartData.courseData || chartData;

      if (!Array.isArray(courseData) && chartData.courseData) {
        courseData = chartData.courseData;
      }
      if (!Array.isArray(courseData) && chartData.data) {
        courseData = chartData.data;
      }

      if (!Array.isArray(courseData) || courseData.length === 0) {
        console.error("[TR2ZWO] No CourseData array found in chart response.", chartData);
        return;
      }

      const zwoXml = toZwoXml(courseData, summary);
      const baseName =
        (summary && summary.workoutName) || `TrainerRoad-${workoutId}`;
      const safeBase = baseName.replace(/[^\w\-]+/g, "_");
      const filename = `${safeBase}-${workoutId}.zwo`;

      console.log("===== TrainerRoad → ZWO XML =====");
      console.log(zwoXml);
      console.log("===== End ZWO XML =====");

      if (shouldDownload) {
        downloadZwo(zwoXml, filename);
      }
    } catch (err) {
      console.error("[TR2ZWO] Error building ZWO:", err);
    }
  }
})();

