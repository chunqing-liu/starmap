import assert from "node:assert/strict";
import path from "node:path";

export async function longWorkflowGeometry(client, titles, until) {
  let geometry, previous, stable = 0;
  await until(async () => {
    geometry = await client.frame.evaluate(names => {
      const bounds = element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }; };
      return { viewport: bounds(document.querySelector(".pipeline-main")), nodes: [...document.querySelectorAll(".react-flow__node")].filter(element => names.some(name => element.textContent.includes(name))).map(element => ({ id: element.getAttribute("data-id"), visible: element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }), ...bounds(element) })) };
    }, titles);
    const current = JSON.stringify(geometry); stable = current === previous ? stable + 1 : 0; previous = current;
    return stable >= 4 && geometry.nodes.length === titles.length && geometry.nodes.every(node => node.visible);
  }, "Long workflow layout did not settle", 12000);
  for (const [index, node] of geometry.nodes.entries()) {
    assert(node.width > 0 && node.height > 0);
    assert(node.x >= geometry.viewport.x - 1 && node.y >= geometry.viewport.y - 1 && node.right <= geometry.viewport.right + 1 && node.bottom <= geometry.viewport.bottom + 1, "Long workflow node outside fitted canvas: " + JSON.stringify(node));
    for (const other of geometry.nodes.slice(index + 1)) assert(node.right <= other.x + 1 || other.right <= node.x + 1 || node.bottom <= other.y + 1 || other.bottom <= node.y + 1, "Long workflow nodes overlap: " + node.id + " / " + other.id);
  }
  return geometry;
}

export async function desktopGeometry(client, run) {
  const results = [];
  for (const requested of [{ width: 1440, height: 960 }, { width: 1280, height: 720 }, { width: 960, height: 760 }]) {
    await client.window.evaluate((window, size) => { window.restore(); window.setContentSize(size.width, size.height); }, requested);
    if (requested.width === 960) {
      for (const name of ["收起左侧星轨栏", "收起右侧详情栏"]) {
        const button = client.frame.getByRole("button", { name, exact: true });
        if (await button.isVisible()) await button.click();
      }
    }
    let measurement, previous, stable = 0;
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const content = await client.window.evaluate(window => window.getContentSize());
      const host = await client.page.evaluate(() => { const frame = document.querySelector(".plugin-frame"); const rect = frame.getBoundingClientRect(); return { width: innerWidth, height: innerHeight, frame: { x: rect.x, y: rect.y, width: frame.clientWidth, height: frame.clientHeight } }; });
      const plugin = await client.frame.evaluate(() => {
        const bounds = selector => { const rect = document.querySelector(selector).getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right }; };
        return { width: innerWidth, height: innerHeight, visibility: document.visibilityState, overflow: document.documentElement.scrollWidth - innerWidth, canvas: bounds(".pipeline-main"), toolbar: bounds(".pipeline-page-toolbar"), sync: bounds(".pipeline-network-summary") };
      });
      measurement = { requested, content, host, plugin };
      const matching = content[0] === requested.width && content[1] === requested.height && host.width === requested.width && host.height === requested.height && Math.abs(plugin.width - host.frame.width) <= 1 && Math.abs(plugin.height - host.frame.height) <= 1;
      const serialized = JSON.stringify(measurement);
      stable = matching && serialized === previous ? stable + 1 : 0;
      previous = serialized;
      if (stable >= 4) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(stable >= 4, "Desktop viewport did not settle at requested dimensions: " + JSON.stringify(measurement));
    assert.equal(measurement.plugin.visibility, "visible");
    assert(measurement.plugin.overflow <= 1, JSON.stringify(measurement));
    assert(measurement.plugin.canvas.height >= 120, JSON.stringify(measurement));
    for (const section of [measurement.plugin.canvas, measurement.plugin.toolbar, measurement.plugin.sync]) {
      assert(section.width > 0 && section.height > 0 && section.x >= -1 && section.y >= -1 && section.right <= measurement.plugin.width + 1 && section.bottom <= measurement.plugin.height + 1, JSON.stringify(measurement));
    }
    results.push(measurement);
    await client.page.screenshot({ path: path.join(run, "electron-geometry-" + requested.width + ".png") });
  }
  assert.equal(new Set(results.map(result => result.plugin.width)).size, results.length, "Distinct window sizes must produce distinct plugin widths");
  return results;
}
