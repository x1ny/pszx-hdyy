(function () {
  const statusClass = { "已上架": "green", "未发布": "gray", "已下架": "red", "正常": "green", "作废": "red", "待确认": "amber", "已确认": "green", "已退回": "red", "未配置": "gray", "未开启": "gray", "未处理": "gray", "待处理": "amber", "待配置": "amber", "配置中": "amber", "已配置": "green", "已关联资源": "green", "已标记仅记录": "cyan", "已处理": "green", "无需求": "green", "仅记录": "cyan", "仅登记": "cyan", "记录需求": "cyan", "新建资源安排": "amber", "引用已有资源安排": "amber", "未提醒": "amber", "待提醒": "amber", "已提醒": "green", "待发送": "amber", "发送成功": "green", "发送失败": "red", "生成成功": "green", "生成失败": "red", "同记录展示": "green", "已提交": "amber", "审核通过": "green", "审核不通过": "red", "启用": "green", "禁用": "gray" };
  const nav = [
    { title: "工作台", items: [{ label: "运营工作台", href: "dashboard.html", keys: ["dashboard.html"] }] },
    { title: "项目管理", items: [{ label: "项目列表", href: "project-list.html", keys: ["project-list.html", "project-detail.html", "project-members.html", "activity-list.html", "activity-detail.html", "activity-config.html", "agenda-timeline.html", "session-config.html", "activity-space.html", "resource-summary.html", "resource-ledger.html", "registration-review.html"] }] },
    { title: "人员管理", items: [{ label: "全量人员库", href: "member-master.html", keys: ["member-master.html"] }, { label: "活动人员", href: "activity-members.html", keys: ["activity-members.html"] }] },
    { title: "邀请函管理", items: [{ label: "发函文件模板", href: "invitation-templates.html", keys: ["invitation-templates.html", "invitation-generate.html"] }, { label: "H5展示", href: "invitation-h5.html", keys: ["invitation-h5.html"] }, { label: "生成记录", href: "invitation-records.html", keys: ["invitation-records.html"] }] },
    { title: "排位管理", items: [{ label: "场地库", href: "venue-library.html", keys: ["venue-library.html", "venue-workbench.html"] }, { label: "排位方案列表", href: "seating-list.html", keys: ["seating-list.html", "seating-canvas.html"] }, { label: "排位确认", href: "seating-confirm.html", keys: ["seating-confirm.html"] }] },
    { title: "供应商管理", items: [{ label: "供应商列表", href: "supplier-list.html", keys: ["supplier-list.html", "supplier-quotes.html"] }] },
    { title: "系统管理", items: [{ label: "用户/角色权限", href: "system-permissions.html", keys: ["system-permissions.html"] }, { label: "消息规则", href: "message-templates.html", keys: ["message-templates.html"] }, { label: "消息发送记录", href: "message-records.html", keys: ["message-records.html"] }] }
  ];
  const activityTabs = [
    ["活动概览", "activity-detail.html"],
    ["配置总览", "activity-config.html"],
    ["议程/环节", "agenda-timeline.html"],
    ["场地空间", "activity-space.html"],
    ["资源需求", "resource-summary.html"],
    ["资源台账", "resource-ledger.html"],
    ["活动人员", "activity-members.html"],
    ["报名审核", "registration-review.html"],
    ["邀请函", "invitation-records.html"],
    ["排位", "seating-list.html"]
  ];
  const activityFiles = new Set(activityTabs.map(([, href]) => href).concat(["seating-canvas.html", "seating-confirm.html", "invitation-generate.html"]));
  function currentFile() {
    const path = location.pathname.split("/").pop();
    return path || "dashboard.html";
  }
  function queryNumber(name, fallback) {
    const value = Number(new URLSearchParams(location.search).get(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
  function currentProjectId() {
    return queryNumber("projectId", 1);
  }
  function currentActivityId() {
    return queryNumber("activityId", 101);
  }
  function currentProject() {
    return Mock.projects.find(p => p.id === currentProjectId()) || Mock.projects[0];
  }
  function currentActivity() {
    return Mock.activities.find(a => a.id === currentActivityId()) || Mock.activities.find(a => a.projectId === currentProjectId()) || Mock.activities[0];
  }
  function adminHref(file, activity) {
    const act = activity || currentActivity();
    const projectId = act?.projectId || currentProjectId();
    const activityPart = act?.id ? `&activityId=${act.id}` : "";
    return `${file}?projectId=${projectId}${activityPart}`;
  }
  function renderAdminNav() {
    const side = document.querySelector(".side-nav");
    if (!side) return;
    const file = currentFile();
    const sections = nav.map(group => {
      const items = group.items.map(item => {
        const active = item.keys?.includes(file) ? " active" : "";
        return `<a class="nav-link${active}" href="${item.href}">${item.label}</a>`;
      }).join("");
      return `<div class="nav-section"><div class="nav-parent">${group.title}</div><div class="nav-sub">${items}</div></div>`;
    }).join("");
    side.innerHTML = `<div class="brand"><div class="brand-mark">活</div><div>活动运营平台</div></div><nav class="nav-group">${sections}</nav>`;
  }
  function renderContextTabs() {
    const file = currentFile();
    if (!activityFiles.has(file)) return;
    const title = document.querySelector(".page-title");
    if (!title || document.querySelector(".context-tabs")) return;
    const tabs = activityTabs.map(([label, href]) => `<a class="tab${href === file ? " active" : ""}" href="${adminHref(href)}">${label}</a>`).join("");
    title.insertAdjacentHTML("afterend", `<div class="context-tabs"><div class="tabs">${tabs}</div></div>`);
  }
  window.tag = function (text) { return `<span class="tag ${statusClass[text] || "blue"}">${text}</span>`; };
  window.money = function (text) { return `￥${text}`; };
  window.toast = function (text) {
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
    el.textContent = text; el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2200);
  };
  window.openModal = id => document.getElementById(id)?.classList.add("show");
  window.closeModal = id => document.getElementById(id)?.classList.remove("show");
  function bindResourceNeedMode() {
    document.querySelectorAll("[data-need-mode]").forEach(select => {
      const form = select.closest(".mini-form");
      if (!form) return;
      const newField = form.querySelector("[data-new-resource-field]");
      const existingField = form.querySelector("[data-existing-resource-field]");
      const sync = () => {
        const value = select.value;
        if (newField) newField.style.display = value === "新建资源安排" ? "" : "none";
        if (existingField) existingField.style.display = value === "引用已有资源安排" ? "" : "none";
      };
      select.addEventListener("change", sync);
      sync();
    });
  }
  window.setRole = function (role) {
    localStorage.setItem("prototypeRole", role);
    document.querySelectorAll("[data-role-label]").forEach(el => el.textContent = role);
    document.querySelectorAll("[data-manager-only]").forEach(el => { el.disabled = role === "运营人员"; el.title = role === "运营人员" ? "当前角色无删除/确认权限" : ""; });
  };
  window.renderProjectRows = function () {
    const tbody = document.querySelector("[data-project-rows]");
    if (!tbody) return;
    tbody.innerHTML = Mock.projects.map(p => {
      const activityCount = Mock.activities.filter(a => a.projectId === p.id).length;
      return `<tr>
      <td><a class="link" href="project-detail.html?projectId=${p.id}">${p.name}</a></td><td>${p.place}</td><td>${p.start} 至 ${p.end}</td><td>${money(p.budget)}</td><td>${activityCount}</td><td>${tag(p.status)}</td>
      <td><div class="toolbar"><a class="btn" href="project-detail.html?projectId=${p.id}">查看</a><button class="btn" onclick="toast('已模拟${p.status === "已上架" ? "下架" : "上架"}')">${p.status === "已上架" ? "下架" : "上架"}</button><button data-manager-only class="btn danger" onclick="toast('已进入删除确认')">删除</button></div></td>
    </tr>`;
    }).join("");
  };
  window.renderActivityRows = function () {
    const tbody = document.querySelector("[data-activity-rows]");
    if (!tbody) return;
    const project = currentProject();
    const rows = Mock.activities.filter(a => a.projectId === project.id);
    const configText = a => `${a.configDone || 0}/${a.configTotal || 0} 项`;
    if (currentFile() === "activity-list.html") {
      tbody.innerHTML = rows.map(a => `<tr>
        <td><a class="link" href="${adminHref("activity-detail.html", a)}">${a.name}</a><br><small class="muted">${a.type}</small></td><td>${project.name}</td><td>${a.place}</td><td>${a.start}<br>${a.end}</td><td>${money(a.budget || "-")}</td><td>${a.media?.images || 0} 图 / ${a.media?.videos || 0} 视频</td><td>${tag(a.status)}</td><td>${configText(a)}</td>
        <td><div class="toolbar"><a class="btn" href="${adminHref("activity-detail.html", a)}">详情</a><button class="btn" onclick="openModal('activityModal')">编辑</button><a class="btn" href="${adminHref("activity-config.html", a)}">配置</a></div></td>
      </tr>`).join("");
      return;
    }
    tbody.innerHTML = rows.map(a => `<tr>
      <td><a class="link" href="${adminHref("activity-detail.html", a)}">${a.name}</a><br><small class="muted">${a.type}</small></td><td>${a.place}</td><td>${a.start}<br>${a.end}</td><td>${money(a.budget || "-")}</td><td>${tag(a.status)}</td><td>${a.display ? "开启" : "关闭"}</td><td>${a.signup ? "开启" : "关闭"}</td><td>${configText(a)}</td>
      <td><div class="toolbar"><a class="btn" href="${adminHref("activity-detail.html", a)}">详情</a><button class="btn" onclick="openModal('activityModal')">编辑</button><a class="btn" href="${adminHref("activity-config.html", a)}">配置</a></div></td>
    </tr>`).join("");
  };
  window.renderMemberRows = function () {
    const tbody = document.querySelector("[data-member-rows]");
    if (!tbody) return;
    tbody.innerHTML = Mock.members.map(m => `<tr><td>${m.name}</td><td>${m.gender}</td><td>${m.region}</td><td>${m.native}</td><td>${m.certType}</td><td>${m.certNo.slice(0,4)}********${m.certNo.slice(-4)}</td><td>${m.title}</td><td>${m.contact}</td><td>${m.email}</td><td>${m.lang}</td><td>${tag(m.status)}</td><td><button class="btn" onclick="openModal('memberMasterModal')">详情</button></td></tr>`).join("");
  };
  window.renderResourceRows = function () {
    const tbody = document.querySelector("[data-resource-rows]");
    if (!tbody) return;
    tbody.innerHTML = Mock.resources.map(r => {
      const canBind = ["用车", "用餐", "住宿"].includes(r.type);
      return `<tr><td>${r.type}<br><small class="muted">${r.scene}</small></td><td>${r.name}<br><small class="muted">来源：${r.source || "-"}</small></td><td>${r.requirement || "-"}</td><td>${r.time}</td><td>${r.place}</td><td>${r.people || "-"}</td><td>${r.vehicle}</td><td>${r.driver}</td><td>${tag(r.status)}</td><td><div class="toolbar"><button class="btn" onclick="openModal('resourceModal')">编辑安排</button>${canBind ? `<button class="btn primary" onclick="openModal('bindModal')">绑定人员</button>` : `<button class="btn" disabled title="物料不绑定人员">无需绑定</button>`}</div></td></tr>`;
    }).join("");
  };
  window.renderInvitationRows = function () {
    const tbody = document.querySelector("[data-invitation-rows]");
    if (!tbody) return;
    tbody.innerHTML = Mock.invitations.map(i => `<tr><td>${i.id}</td><td>${i.activity}</td><td>${i.template}</td><td>${i.generated}/${i.count}</td><td>${i.failed ? tag("生成失败") : tag("同记录展示")}</td><td>${tag(i.notify)}</td><td>${i.time}</td><td><div class="toolbar"><button class="btn" onclick="openModal('invitePeopleModal')">查看名单</button><button class="btn">下载</button><button class="btn primary" onclick="openModal('notifyModal')">发送提醒</button><a class="btn" href="message-records.html">发送记录</a></div></td></tr>`).join("");
  };
  window.renderSeatingRows = function () {
    const tbody = document.querySelector("[data-seating-rows]");
    if (!tbody) return;
    tbody.innerHTML = Mock.seating.map(s => `<tr><td>${s.activity}</td><td>${s.session}</td><td>${s.venue}</td><td>${tag(s.status)}</td><td>${s.savedBy}</td><td>${s.savedAt}</td><td><div class="toolbar"><a class="btn" href="${adminHref("seating-canvas.html")}">进入画布</a><a class="btn" href="${adminHref("seating-confirm.html")}">确认页</a><button data-manager-only class="btn primary" onclick="toast('已模拟确认排位')">确认</button><button data-manager-only class="btn" onclick="toast('已模拟退回')">退回</button></div></td></tr>`).join("");
  };
  window.renderMessageRows = function () {
    const tbody = document.querySelector("[data-message-rows]");
    if (!tbody) return;
    tbody.innerHTML = Mock.messages.map(m => `<tr><td>${m.type}</td><td>${m.object}</td><td>${m.target}</td><td>${m.channel}</td><td>${tag(m.status)}</td><td>${m.time}</td><td><button class="btn" onclick="toast('已打开发送记录详情')">详情</button></td></tr>`).join("");
  };
  document.addEventListener("DOMContentLoaded", () => {
    renderAdminNav();
    renderContextTabs();
    setRole(localStorage.getItem("prototypeRole") || "管理人员");
    bindResourceNeedMode();
    renderProjectRows(); renderActivityRows(); renderMemberRows(); renderResourceRows(); renderInvitationRows(); renderSeatingRows(); renderMessageRows();
    document.querySelectorAll("[data-toast]").forEach(btn => btn.addEventListener("click", () => toast(btn.dataset.toast)));
  });
})();
