(function () {
  const storeKey = "activity-prototype-h5-person";
  const registrationKey = "activity-prototype-registration-status";

  function $(selector) {
    return document.querySelector(selector);
  }

  function currentPerson() {
    const id = Number(localStorage.getItem(storeKey) || 1);
    return Mock.members.find((m) => m.id === id) || Mock.members[0];
  }

  function isLoggedIn() {
    return Boolean(localStorage.getItem(storeKey));
  }

  function isPublicFlow() {
    return new URLSearchParams(location.search).get("from") === "entry";
  }

  function queryNumber(name, fallback) {
    const value = Number(new URLSearchParams(location.search).get(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function activityHref(page, act, from) {
    const suffix = from ? `&from=${from}` : "";
    return `${page}?projectId=${act.projectId}&activityId=${act.id}${suffix}`;
  }

  function blankPerson() {
    return { name: "", gender: "", region: "", native: "", certType: "", certNo: "", title: "", contact: "", email: "", lang: "" };
  }

  function setPerson(id) {
    localStorage.setItem(storeKey, String(id));
  }

  function project() {
    const id = queryNumber("projectId", 1);
    return Mock.projects.find((p) => p.id === id) || Mock.projects.find((p) => p.id === 1);
  }

  function activity() {
    const id = queryNumber("activityId", 101);
    return Mock.activities.find((a) => a.id === id) || Mock.activities.find((a) => a.id === 101);
  }

  function visibleActivities() {
    return Mock.activities.filter((a) => a.status === "已上架" && a.display);
  }

  function isManagedActivity(act) {
    return act && act.type !== "配套活动";
  }

  function projectById(id) {
    return Mock.projects.find((p) => p.id === id);
  }

  function registrationStatus() {
    const saved = localStorage.getItem(registrationKey);
    if (saved) return saved;
    return currentPerson().id === 1 ? "审核通过" : "未报名";
  }

  function sessionIntro(name) {
    const map = {
      "开幕式": "嘉宾入场、主持开场、领导致辞。",
      "开幕大秀": "闽派服饰品牌联合走秀。",
      "设计师品牌展演": "新锐设计师作品发布。",
      "面料趋势沙龙": "2027 春夏面料趋势分享。",
      "品牌交流酒会": "品牌方、买手及嘉宾自由交流。"
    };
    return map[name] || "活动环节安排。";
  }

  function tag(text, color) {
    return `<span class="h5-tag ${color || "blue"}">${text}</span>`;
  }

  function toast(text) {
    const node = $(".toast") || document.createElement("div");
    node.className = "toast show";
    node.textContent = text;
    if (!node.parentNode) document.body.appendChild(node);
    window.setTimeout(() => node.classList.remove("show"), 1800);
  }

  function shell(title, subtitle, active, content, backHref) {
    const back = backHref ? `<a class="back" href="${backHref}" aria-label="返回">‹</a>` : "";
    return `
      <div class="phone-frame">
        <div class="h5-screen">
          <header class="h5-top">
            ${back}
            <div class="h5-title"><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ""}</div>
          </header>
          <main class="h5-content">${content}</main>
        </div>
        <div class="toast"></div>
      </div>`;
  }

  function kv(label, value) {
    return `<div class="row"><span>${label}</span><span>${value || "-"}</span></div>`;
  }

  function renderLogin() {
    $("#app").innerHTML = `
      <div class="phone-frame">
        <header class="h5-top">
          <a class="back" href="entry.html" aria-label="返回">‹</a>
          <div class="h5-title"><h1>泉州纺织服装时尚周</h1></div>
        </header>
        <main class="h5-content login-content">
          <section class="login-hero">
            <div>
              <h1>登录</h1>
              <p>登录后查看报名结果、邀请函、座位和行程信息</p>
            </div>
          </section>
          <section class="login-panel">
            <div class="form-grid">
              <div class="h5-field"><label class="required">手机号</label><input id="phoneInput" value="13800001234" inputmode="tel"></div>
              <div class="h5-field code-field">
                <label class="required">验证码</label>
                <div class="code-row"><input id="codeInput" value="123456" inputmode="numeric"><button type="button">获取验证码</button></div>
              </div>
              <button class="h5-btn primary" id="loginBtn">登录</button>
              <a class="login-entry-link" href="entry.html">返回入口</a>
            </div>
          </section>
        </main>
        <div class="toast"></div>
      </div>`;
    $("#loginBtn").addEventListener("click", () => {
      const phone = $("#phoneInput").value.trim();
      const matched = Mock.members.filter((m) => m.contact.includes(phone));
      if (!phone || !$("#codeInput").value.trim()) return toast("请填写手机号和验证码");
      if (matched.length > 1) location.href = "identity-select.html";
      else {
        if (matched[0]) setPerson(matched[0].id);
        location.href = "my-activities.html";
      }
    });
  }

  function renderIdentitySelect() {
    const matched = Mock.members.filter((m) => m.contact.includes("13800001234"));
    const list = matched.map((m) => `
      <button class="item identity-choice" data-id="${m.id}">
        <h3>${m.name}</h3>
        <p>${[m.company, m.title].filter(Boolean).join(" · ")}</p>
      </button>`).join("");
    $("#app").innerHTML = shell("选择人员身份", "同一手机号关联多人", "", `<div class="list">${list}</div>`, "login.html");
    document.querySelectorAll(".identity-choice").forEach((btn) => {
      btn.addEventListener("click", () => {
        setPerson(btn.dataset.id);
        location.href = "my-activities.html";
      });
    });
  }

  function entryProjects(keyword) {
    const groups = Mock.projects.filter((p) => p.status === "已上架").map((p) => {
      const activities = visibleActivities().filter((a) => a.projectId === p.id);
      const projectText = `${p.name} ${p.place} ${p.desc}`;
      const matchProject = !keyword || projectText.includes(keyword);
      return { project: p, activities, matchProject };
    }).filter((group) => group.matchProject);

    return groups.map((group) => {
      const p = group.project;
      const availableCount = group.activities.filter((a) => a.signup).length;
      return `
        <section class="project-block">
          <div class="project-summary">
            <h3>${p.name}</h3>
            <p class="project-meta-line"><span class="meta-icon place" aria-hidden="true"></span>${p.place}</p>
            <p class="project-meta-line"><span class="meta-icon time" aria-hidden="true"></span>${p.start} 至 ${p.end}</p>
            <p class="project-desc">${p.desc}</p>
            <div class="chips">${tag(`${group.activities.length}场活动`, "blue")}${availableCount ? tag(`${availableCount}场可报名`, "green") : tag("暂无可报名", "gray")}</div>
            <div class="btn-row"><a class="h5-btn primary" href="project-detail.html?projectId=${p.id}&from=entry">查看项目详情</a></div>
          </div>
        </section>`;
    }).join("");
  }

  function renderEntry() {
    const publishedCount = Mock.projects.filter((p) => p.status === "已上架").length;
    $("#app").innerHTML = shell("泉州纺织服装时尚周", "", "", `
      <section class="entry-hero">
        <div class="entry-hero-text">
          <span>2026 QUANZHOU FASHION WEEK</span>
          <h2>纺织服装产业活动报名</h2>
          <p>11.18-11.24 · 泉州</p>
        </div>
        <div class="entry-hero-meta">
          <b>${publishedCount}</b><span>个项目开放查看</span>
        </div>
      </section>
      <div class="search-box">
        <input id="activitySearch" placeholder="搜索项目名称、地点" aria-label="搜索项目">
        <button class="h5-btn small" id="activitySearchBtn">查询</button>
      </div>
      <div class="section-title"><h2>项目列表</h2></div>
      <div id="entryProjects">${entryProjects("")}</div>
      <a class="entry-login-fab" href="login.html">登录</a>`);
    const input = $("#activitySearch");
    const update = () => {
      const html = entryProjects(input.value.trim());
      $("#entryProjects").innerHTML = html || `<div class="empty-state">未查询到相关项目</div>`;
    };
    input.addEventListener("input", update);
    $("#activitySearchBtn").addEventListener("click", update);
  }

  function renderMyActivities() {
    const p = currentPerson();
    const currentActivities = Mock.activities
      .filter((a) => a.status === "已上架" && a.display && a.business === "进行中" && isManagedActivity(a))
      .sort((a, b) => a.start.localeCompare(b.start));
    const firstActivity = currentActivities[0] || activity();
    const otherActivities = currentActivities.slice(1);
    const profileText = [p.company, p.title].filter(Boolean).join(" · ");
    const agendaText = (a, expanded) => {
      const rows = Mock.sessions
        .filter((s) => s.activityId === a.id && s.status === "正常")
        .sort((x, y) => `${x.start}${x.order}`.localeCompare(`${y.start}${y.order}`));
      const shown = expanded ? rows : rows.slice(0, 3);
      const summary = shown.map((s) => `${s.start} ${s.name}`).join(" · ");
      return summary ? `${summary}${!expanded && rows.length > 3 ? " ..." : ""}` : "暂无议程安排";
    };
    const renderOngoingCard = (a, pinned) => {
      if (!pinned) {
        return `
          <article class="ongoing-card compact">
            <h3>${a.name}</h3>
            <p>${a.start} · ${a.place}</p>
            <div class="chips">${tag(a.type, "blue")}${tag(a.business, "cyan")}</div>
            <div class="item-actions">
              <a class="h5-btn small" href="${activityHref("activity-detail.html", a, "")}">查看详情</a>
            </div>
          </article>`;
      }
      return `
        <article class="ongoing-card pinned">
          <h3>${a.name}</h3>
          <p>${a.start} · ${a.place}</p>
          <div class="chips">${tag(a.type, "blue")}${tag(a.business, "cyan")}</div>
          <div class="pinned-agenda">
            <h4>主要议程</h4>
            <p>
              <span id="pinnedAgendaText">${agendaText(a, false)}</span>
              <button class="inline-toggle" id="togglePinnedMore" type="button" data-expanded="false">展开</button>
            </p>
          </div>
          <div class="item-actions">
            <a class="h5-btn small" href="${activityHref("activity-detail.html", a, "")}">查看详情</a>
          </div>
        </article>`;
    };
    $("#app").innerHTML = `
      <div class="phone-frame">
        <div class="h5-screen">
          <header class="h5-top">
            <div class="h5-title"><h1>泉州纺织服装时尚周</h1></div>
            <a class="top-home-btn" href="entry.html" aria-label="活动主页" title="活动主页">⌂</a>
          </header>
          <main class="h5-content my-content">
            <section>
              <section class="profile-card compact">
                <div class="profile-main">
                  <div class="avatar">${p.name.slice(0, 1)}</div>
                  <div>
                    <h2>${p.name}</h2>
                    <p>${profileText}<br>${p.contact}</p>
                  </div>
                </div>
                <div class="profile-actions">
                  <a class="h5-btn small" href="profile.html">查看资料</a>
                  <a class="h5-btn small" href="messages.html">消息通知</a>
                </div>
              </section>
              <div class="section-title"><h2>进行中</h2><a href="my-history.html">历史活动</a></div>
              <section class="h5-card">
                <div class="h5-card-body ongoing-list">
                  ${renderOngoingCard(firstActivity, true)}
                  ${otherActivities.map((a) => renderOngoingCard(a, false)).join("")}
                </div>
              </section>
            </section>
          </main>
        </div>
        <div class="toast"></div>
      </div>`;
    $("#togglePinnedMore")?.addEventListener("click", () => {
      const btn = $("#togglePinnedMore");
      const expanded = btn.dataset.expanded === "true";
      btn.dataset.expanded = expanded ? "false" : "true";
      $("#pinnedAgendaText").textContent = agendaText(firstActivity, !expanded);
      btn.textContent = expanded ? "展开" : "收起";
    });
  }

  function renderHome() {
    renderMyActivities();
  }

  function renderProjectList() {
    renderEntry();
  }

  function renderProjectDetail() {
    const p = project();
    const projectActivities = visibleActivities().filter((a) => a.projectId === p.id);
    const renderActivities = (keyword, activityType, businessStatus, signupStatus) => visibleActivities().filter((a) => {
      const text = `${a.name} ${a.type} ${a.place} ${a.desc}`;
      const matchKeyword = !keyword || text.includes(keyword);
      const matchType = activityType === "全部" || a.type === activityType;
      const matchBusiness = businessStatus === "全部" || a.business === businessStatus;
      const matchSignup = signupStatus === "全部" || (isManagedActivity(a) && ((signupStatus === "可报名" && a.signup) || (signupStatus === "报名关闭" && !a.signup)));
      return a.projectId === p.id && matchKeyword && matchType && matchBusiness && matchSignup;
    }).map((a) => `
      <article class="mobile-activity-card">
        <div class="activity-cover">
          <span>${a.type}</span>
          <b>${a.business}</b>
        </div>
        <div class="mobile-activity-body">
          <div class="item-top"><h3>${a.name}</h3>${isManagedActivity(a) ? (a.signup ? tag("可报名", "green") : tag("报名关闭", "gray")) : ""}</div>
          <p>${a.start}</p>
          <p>${a.place}</p>
          <p class="activity-desc">${a.desc}</p>
          <div class="item-actions">
            <a class="h5-btn small" href="${activityHref("activity-detail.html", a, "entry")}">查看详情</a>
            ${isManagedActivity(a) && a.signup ? `<a class="h5-btn small primary" href="${activityHref("registration.html", a, "entry")}">报名</a>` : ""}
          </div>
        </div>
      </article>`).join("");
    $("#app").innerHTML = shell("项目详情", p.name, "", `
      <section class="project-detail-hero">
        <div class="project-hero-cover">
          <span>QUANZHOU FASHION WEEK</span>
          <h2>${p.name}</h2>
          <p>${p.start} 至 ${p.end}</p>
        </div>
      </section>
      <section class="project-intro-card">
        <h2>项目介绍</h2>
        <p class="project-intro-text">${p.desc}</p>
        <div class="project-info-grid">
          <div><span>地点</span><b>${p.place}</b></div>
          <div><span>主办单位</span><b>${p.host}</b></div>
          <div><span>承办单位</span><b>${p.organizer}</b></div>
          <div><span>指导单位</span><b>${p.guide}</b></div>
        </div>
      </section>
      <div class="section-title"><h2>活动列表</h2></div>
      <section class="activity-filter-panel">
        <div class="search-box compact">
          <input id="projectActivitySearch" placeholder="搜索活动名称、地点">
          <button class="h5-btn small" id="projectActivitySearchBtn">查询</button>
        </div>
        <div class="filter-line">
          <span>类型</span>
          <div class="filter-scroll">
            <button class="active" data-group="type" data-value="全部">全部</button>
            <button data-group="type" data-value="自主策划">自主策划</button>
            <button data-group="type" data-value="配套活动">配套活动</button>
          </div>
        </div>
        <div class="filter-line">
          <span>状态</span>
          <div class="filter-scroll">
            <button class="active" data-group="business" data-value="全部">全部</button>
            <button data-group="business" data-value="未开始">未开始</button>
            <button data-group="business" data-value="进行中">进行中</button>
            <button data-group="business" data-value="已结束">已结束</button>
          </div>
        </div>
        <div class="filter-line">
          <span>报名</span>
          <div class="filter-scroll">
            <button class="active" data-group="signup" data-value="全部">全部</button>
            <button data-group="signup" data-value="可报名">可报名</button>
            <button data-group="signup" data-value="报名关闭">报名关闭</button>
          </div>
        </div>
      </section>
      <div id="projectActivities" class="activity-card-list">${renderActivities("", "全部", "全部", "全部")}</div>`, "entry.html");
    const input = $("#projectActivitySearch");
    const filters = { type: "全部", business: "全部", signup: "全部" };
    const update = () => {
      const html = renderActivities(input.value.trim(), filters.type, filters.business, filters.signup);
      $("#projectActivities").innerHTML = html || `<div class="empty-state">未查询到相关活动</div>`;
    };
    input.addEventListener("input", update);
    $("#projectActivitySearchBtn").addEventListener("click", update);
    document.querySelectorAll(".filter-scroll button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const group = btn.dataset.group;
        filters[group] = btn.dataset.value;
        document.querySelectorAll(`.filter-scroll button[data-group="${group}"]`).forEach((node) => node.classList.remove("active"));
        btn.classList.add("active");
        update();
      });
    });
  }

  function renderActivityList() {
    const acts = visibleActivities().filter((a) => a.projectId === project().id).map((a) => `
      <a class="item" href="${activityHref("activity-detail.html", a, isPublicFlow() ? "entry" : "")}">
        <h3>${a.name}</h3>
        <p>${a.type} · ${a.start} · ${a.place}</p>
        <div class="chips">${tag(a.business, "cyan")}${isManagedActivity(a) ? (a.signup ? tag("可报名", "blue") : tag("报名关闭", "gray")) : ""}</div>
      </a>`).join("");
    $("#app").innerHTML = shell("活动列表", project().name, isLoggedIn() ? "history" : "", `
      <section class="h5-card">
        <div class="h5-card-head"><h2>项目下活动</h2></div>
        <div class="h5-card-body list">${acts || `<div class="empty-state">暂无可见活动</div>`}</div>
      </section>`, "project-detail.html");
  }

  function renderActivityDetail() {
    const a = activity();
    const status = registrationStatus();
    const managed = isManagedActivity(a);
    const personalMode = managed && isLoggedIn() && !isPublicFlow();
    const alreadyRegistered = isLoggedIn() && status !== "未报名";
    const signupAction = managed && a.signup && !alreadyRegistered
      ? `<a class="activity-signup-fab" href="${activityHref("registration.html", a, "entry")}">立即报名</a>`
      : "";
    const agendaItems = Mock.sessions.filter((s) => s.activityId === a.id && s.status === "正常").map((s) => `
      <div class="service-timeline-item">
        <div class="service-time">${s.start}-${s.end}</div>
        <div>
          <h3>${s.name}</h3>
          <p>${s.place} · ${sessionIntro(s.name)}</p>
        </div>
      </div>`).join("");
    const agendaContent = agendaItems || `<div class="empty-state">暂无议程安排</div>`;
    const serviceBlock = !managed ? "" : personalMode ? `
      <div class="service-main-title">
        <h2>服务安排</h2>
        <p>查看与本人相关的议程、座位、行程和邀请函信息。</p>
      </div>
      <section class="activity-service-section">
        <div class="service-section no-gap">
          <div class="section-title inline"><h2>主要议程</h2><a href="agenda.html">查看全部</a></div>
          <div class="service-timeline">${agendaContent}</div>
        </div>
      </section>
      <section class="activity-service-section">
        <div class="section-title inline"><h2>排位信息</h2><a href="seat-detail.html">查看详情</a></div>
        <div class="list">
          <a class="item" href="seat-detail.html"><h3>开幕式</h3><p>主会场 A 区 A1 · 嘉宾席第一排。</p></a>
          <a class="item" href="seat-detail.html"><h3>开幕大秀</h3><p>主秀场 B 区 B12 · 嘉宾观秀席。</p></a>
          <a class="item" href="seat-detail.html"><h3>品牌交流酒会</h3><p>海丝艺术中心二层 · 贵宾交流区 03 桌。</p></a>
        </div>
      </section>
      <section class="activity-service-section">
        <div class="section-title inline"><h2>行程信息</h2><a href="trip.html">查看详情</a></div>
        <div class="list">
          <a class="item" href="trip.html"><h3>来程</h3><p>动车 D3126 · 厦门北至泉州 · 2026-11-17 16:08 出发 / 18:12 抵达。</p></a>
          <a class="item" href="trip.html"><h3>接送安排</h3><p>机场接送一号车 · 闽C D2638 · 许师傅 139****8621 · 18:30 到达口等候。</p></a>
          <a class="item" href="trip.html"><h3>返程</h3><p>航班 MF8792 · 泉州至上海 · 2026-11-20 16:45 起飞 / 18:30 抵达。</p></a>
        </div>
      </section>
      <section class="activity-service-section">
        <div class="section-title inline"><h2>更多信息</h2></div>
        <div class="list more-entry-list">
          <a class="item more-entry" href="venue-map.html">
            <div><h3>活动场地图</h3><p>查看主秀场、洽谈区、服务区等活动空间安排。</p></div>
            <span aria-hidden="true">›</span>
          </a>
          <a class="item more-entry" href="invitation.html">
            <div><h3>邀请函</h3><p>查看邀请函和转发分享。</p></div>
            <span aria-hidden="true">›</span>
          </a>
        </div>
      </section>` : `
      <section class="service-login-card">
        <h2>服务信息</h2>
        <a class="h5-btn dark" href="login.html">登录</a>
        <p>登录后可查看座位信息、行程信息、邀请函等</p>
      </section>`;
    $("#app").innerHTML = shell("活动详情", a.name, "", `
      <section class="activity-hero">
        <div class="activity-hero-image">
          <span>${a.media.cover}</span>
          <h2>${a.name}</h2>
        </div>
      </section>
      <section class="activity-info-card">
        <div class="section-title inline activity-card-title"><h2>活动概览</h2></div>
        <div class="activity-status-row">${tag(a.type, "blue")}${tag(a.business, "blue")}${managed && a.signup ? tag("可报名", "green") : ""}</div>
        <div class="activity-info-list">
          <div><span class="meta-icon time" aria-hidden="true"></span><p>${a.start} 至 ${a.end}</p></div>
          <div><span class="meta-icon place" aria-hidden="true"></span><p>${a.place}</p></div>
        </div>
        <h2>活动介绍</h2>
        <p class="activity-intro-text">${a.desc}</p>
        <div class="activity-org-list">
          <div><span>主办单位</span><b>${a.host}</b></div>
          <div><span>承办单位</span><b>${a.organizer}</b></div>
          <div><span>支持单位</span><b>${a.support}</b></div>
          <div><span>指导单位</span><b>${a.guide}</b></div>
        </div>
      </section>
      ${serviceBlock}
      ${signupAction}`, personalMode ? "my-activities.html" : `project-detail.html?projectId=${a.projectId}&from=entry`);
  }

  function profileFields(person, required, includePhone) {
    const req = required ? " required" : "";
    const certTypes = ["身份证", "护照", "港澳居民来往内地通行证", "台湾居民来往大陆通行证", "外国人永久居留身份证", "其他"];
    const certOptions = certTypes.map((type) => `<option ${person.certType === type ? "selected" : ""}>${type}</option>`).join("");
    return `
      <div class="h5-field"><label class="required">姓名</label><input${req} name="name" value="${person.name}"></div>
      <div class="h5-field"><label class="required">性别</label><select${req} name="gender"><option value="">请选择</option><option ${person.gender === "男" ? "selected" : ""}>男</option><option ${person.gender === "女" ? "selected" : ""}>女</option></select></div>
      <div class="h5-field"><label>国别/地区</label><input name="region" value="${person.region}"></div>
      <div class="h5-field"><label>籍贯</label><input name="native" value="${person.native}"></div>
      <div class="h5-field"><label class="required">证件类型</label><select${req} name="certType"><option value="">请选择</option>${certOptions}</select></div>
      <div class="h5-field"><label class="required">证件号码</label><input${req} name="certNo" value="${person.certNo}"></div>
      <div class="h5-field"><label class="required">职务</label><input${req} name="title" value="${person.title}"></div>
      ${includePhone ? `<div class="h5-field"><label class="required">手机号</label><input${req} name="phone" value="${person.contact.split(" / ")[0]}"></div>` : ""}
      <div class="h5-field"><label>邮箱</label><input name="email" value="${person.email}"></div>
      <div class="h5-field"><label>语种</label><input name="lang" value="${person.lang}"></div>`;
  }

  function renderRegistration() {
    const publicFlow = isPublicFlow() || !isLoggedIn();
    const a = activity();
    const p = publicFlow ? blankPerson() : currentPerson();
    $("#app").innerHTML = shell("活动报名", a.name, "", `
      <form id="registrationForm" class="h5-card">
        <div class="h5-card-head"><h2>报名信息</h2></div>
        <div class="h5-card-body form-grid">
          ${profileFields(p, true, true)}
          <div class="notice">报名提交后可通过手机号登录个人中心查看报名结果和活动服务信息。</div>
          <button class="h5-btn primary" type="submit">提交报名</button>
        </div>
      </form>`, publicFlow ? activityHref("activity-detail.html", a, "entry") : activityHref("activity-detail.html", a, ""));
    $("#registrationForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const invalid = Array.from(event.currentTarget.querySelectorAll("[required]")).some((input) => !input.value.trim());
      if (invalid) return toast("请补充必填信息");
      localStorage.setItem(registrationKey, "已提交");
      if (!isLoggedIn()) localStorage.setItem(storeKey, "1");
      location.href = activityHref("registration-result.html", a, "");
    });
  }

  function renderRegistrationResult() {
    const a = activity();
    const status = registrationStatus();
    const color = status === "审核通过" ? "green" : status === "审核不通过" ? "red" : "amber";
    $("#app").innerHTML = shell("报名结果", a.name, "", `
      <section class="h5-card"><div class="h5-card-body">
        <h2>${status}</h2>
        <p class="muted">${status === "审核通过" ? "您已进入活动人员名单，可查看邀请函、议程、行程和座位信息。" : "报名记录已提交后台，审核结果将通过站内信和短信提醒。"}</p>
        <div class="chips">${tag(status, color)}</div>
        <div class="btn-row"><a class="h5-btn primary" href="my-activities.html">进入我的活动</a><a class="h5-btn" href="messages.html">查看消息</a></div>
      </div></section>`, activityHref("activity-detail.html", a, ""));
  }

  function renderHistory() {
    $("#app").innerHTML = shell("历史参与", "", "", `
      <section class="history-list list">
          <a class="item" href="activity-detail.html">
            <h3>品牌私享预展</h3>
            <p>2026-10-28 · 泉州滨江会议中心<br>参与 2 个环节，已归档邀请函和服务记录。</p>
          </a>
          <a class="item" href="activity-detail.html">
            <h3>面料趋势预沟通会</h3>
            <p>2026-10-12 · 泉州国际会展中心<br>报名审核通过，参与 1 个环节。</p>
          </a>
      </section>`, "my-activities.html");
  }

  function renderProfile() {
    const p = currentPerson();
    $("#app").innerHTML = shell("个人信息", "个人信息维护", "", `
      <form id="profileForm" class="h5-card">
        <div class="h5-card-body form-grid">
          ${profileFields(p, false, false)}
          <div class="h5-field"><label>联系方式</label><input value="${p.contact}"></div>
          <button class="h5-btn primary" type="submit">保存个人信息</button>
        </div>
      </form>`, "my-activities.html");
    $("#profileForm").addEventListener("submit", (event) => {
      event.preventDefault();
      toast("个人信息已保存");
    });
  }

  function renderAgenda() {
    const items = Mock.sessions.filter((s) => s.activityId === 101 && s.status === "正常").map((s) => `
      <div class="timeline-item">
        <div class="timeline-time">${s.start}-${s.end}</div>
        <a class="timeline-box" href="activity-detail.html">
          <h3>${s.name}</h3>
          <p>${s.place}</p>
          <p>${sessionIntro(s.name)}</p>
        </a>
      </div>`).join("");
    $("#app").innerHTML = shell("主要议程", activity().name, "", `<section class="timeline">${items}</section>`, "my-activities.html");
  }

  function renderTrip() {
    $("#app").innerHTML = shell("行程", "到离行程与车辆安排", "", `
      <section class="h5-card">
        <div class="h5-card-head"><h2>到离行程</h2></div>
        <div class="h5-card-body trip-body">
          <a class="trip-action-card" href="trip-edit.html">
            <div><b>维护到离行程</b><span>补充或修改来程、返程交通信息</span></div>
            <i aria-hidden="true">›</i>
          </a>
          <div class="trip-route-list">
            <div class="trip-route"><span>来程</span><p>动车 D3126 · 厦门北至泉州 · 11-17 16:08 出发 / 18:12 到达</p></div>
            <div class="trip-route"><span>返程</span><p>航班 MF8792 · 泉州至上海 · 11-20 16:45 起飞 / 18:30 抵达</p></div>
          </div>
        </div>
      </section>
      <section class="h5-card">
        <div class="h5-card-head"><h2>用车安排</h2></div>
        <div class="h5-card-body list vehicle-list">
          <div class="item"><h3>机场接送一号车</h3><p>11-17 18:30 · 泉州晋江国际机场到达口 · 闽C D2638 · 许师傅 139****8621</p></div>
          <div class="item"><h3>开幕秀散场接驳车</h3><p>11-18 21:40 · 主秀场东门至泉州迎宾馆 · 闽C A6188 · 吴师傅 138****5209</p></div>
        </div>
      </section>`, "my-activities.html");
  }

  function renderTripEdit() {
    $("#app").innerHTML = shell("维护到离行程", activity().name, "", `
      <form id="tripForm" class="h5-card">
        <div class="h5-card-body form-grid">
          <div class="h5-field"><label>来程交通方式</label><input value="动车 D3126"></div>
          <div class="h5-field"><label>来程出发/抵达</label><input value="厦门北至泉州 · 11-17 16:08 出发 / 18:12 到达"></div>
          <div class="h5-field"><label>返程交通方式</label><input value="航班 MF8792"></div>
          <div class="h5-field"><label>返程出发/抵达</label><input value="泉州至上海 · 11-20 16:45 起飞 / 18:30 抵达"></div>
          <div class="h5-field"><label>备注</label><textarea placeholder="可填写同行人、行李、接送注意事项等"></textarea></div>
          <button class="h5-btn primary" type="submit">保存行程</button>
        </div>
      </form>`, "trip.html");
    $("#tripForm").addEventListener("submit", (event) => {
      event.preventDefault();
      toast("到离行程已保存");
      window.setTimeout(() => { location.href = "trip.html"; }, 600);
    });
  }

  function renderSeat() {
    $("#app").innerHTML = shell("座位", "本人座位信息", "", `
      <section class="h5-card"><div class="h5-card-body list">
        <div class="item"><h3>开幕式</h3><p>主会场 A 区 A1 · 嘉宾席第一排</p></div>
        <div class="item"><h3>开幕大秀</h3><p>主秀场 B 区 B12 · 嘉宾观秀席</p></div>
        <div class="item"><h3>品牌交流酒会</h3><p>海丝艺术中心二层 · 贵宾交流区 03 桌</p></div>
      </div></section>`, "my-activities.html");
  }

  function renderVenueMap() {
    const a = activity();
    $("#app").innerHTML = shell("活动场地图", a.name, "", `
      <section class="venue-map-card">
        <div class="venue-map-visual" aria-label="活动场地分布图">
          <div class="venue-zone venue-main"><b>主秀场</b><span>A 区 / B 区 / 嘉宾通道</span></div>
          <div class="venue-zone venue-talk"><b>洽谈区</b><span>品牌买手对接</span></div>
          <div class="venue-zone venue-service"><b>服务区</b><span>签到 / 接待 / 用车咨询</span></div>
          <div class="venue-zone venue-media"><b>媒体区</b><span>采访 / 拍摄</span></div>
        </div>
      </section>
      <section class="h5-card">
        <div class="h5-card-head"><h2>区域信息</h2></div>
        <div class="h5-card-body list">
          <div class="item"><h3>主秀场 A 区</h3><p>开幕式、开幕大秀观秀区。入口：南门。</p></div>
          <div class="item"><h3>洽谈 B 区</h3><p>品牌买手对接会及嘉宾洽谈区。</p></div>
          <div class="item"><h3>服务区</h3><p>签到、接待、物料领取和用车咨询。</p></div>
          <div class="item"><h3>媒体区</h3><p>采访、拍摄和媒体登记区域。</p></div>
        </div>
      </section>`, `activity-detail.html?projectId=${a.projectId}&activityId=${a.id}`);
  }

  function renderInvitation() {
    const p = currentPerson();
    $("#app").innerHTML = shell("邀请函详情", "", "", `
      <section class="invitation-card">
        <div class="invitation-kicker">泉州纺织服装时尚周</div>
        <h2>开幕秀邀请函</h2>
        <div class="invitation-project">泉州纺织服装时尚周主项目</div>
        <div class="invited-person">${p.name} ${p.title}</div>
        <p class="invitation-copy">诚邀您出席泉州纺织服装时尚周开幕秀，共同见证闽派服饰品牌与设计力量发布。</p>
        <div class="invitation-info">
          <div><span>参与活动</span><b>泉州纺织服装时尚周开幕秀</b></div>
          <div><span>活动时间</span><b>2026-11-18 19:30 至 21:30</b></div>
          <div><span>活动地点</span><b>泉州海丝艺术公园主秀场</b></div>
          <div><span>参与环节</span><b>开幕式、开幕大秀</b></div>
        </div>
        <div class="invitation-footer">
          <div><span>邀请方</span><b>泉州时尚周组委会</b></div>
          <div><span>邀请时间</span><b>2026-11-17</b></div>
        </div>
      </section>`, "my-activities.html");
  }

  function messageRows() {
    return [
      { id: 1, title: "邀请函提醒", project: "泉州纺织服装时尚周主项目", activity: "泉州纺织服装时尚周开幕秀", text: "您已收到泉州纺织服装时尚周主项目「泉州纺织服装时尚周开幕秀」邀请函，请查看。", href: "invitation.html", state: "未读", time: "2026-11-17 18:30" },
      { id: 2, title: "座位通知", project: "泉州纺织服装时尚周主项目", activity: "泉州纺织服装时尚周开幕秀", text: "泉州纺织服装时尚周主项目「泉州纺织服装时尚周开幕秀」开幕式座位已确认，请查看本人座位信息。", href: "seat-detail.html", state: "已读", time: "2026-11-17 16:10" },
      { id: 3, title: "行程用车提醒", project: "泉州纺织服装时尚周主项目", activity: "泉州纺织服装时尚周开幕秀", text: "泉州纺织服装时尚周主项目「泉州纺织服装时尚周开幕秀」已为您安排机场接送车辆，请查看行程和用车信息。", href: "trip.html", state: "已读", time: "2026-11-17 14:25" },
      { id: 4, title: "报名审核通过", project: "泉州纺织服装时尚周主项目", activity: "泉州纺织服装时尚周开幕秀", text: "您报名的泉州纺织服装时尚周主项目「泉州纺织服装时尚周开幕秀」已审核通过，可查看后续活动服务信息。", href: "registration-result.html", state: "已读", time: "2026-11-16 10:05" }
    ].sort((a, b) => b.time.localeCompare(a.time));
  }

  function renderMessages() {
    const list = messageRows().map((m) => `
      <a class="item message-item" href="${m.title === "邀请函提醒" ? m.href : `message-detail.html?id=${m.id}`}">
        <div class="item-top"><h3>${m.title}</h3>${m.state === "未读" ? tag("未读", "blue") : ""}</div>
        <p class="message-meta">${m.time}</p>
        <p>${m.text}</p>
      </a>`).join("");
    $("#app").innerHTML = shell("消息", "", "", `<div class="list">${list}</div>`, "my-activities.html");
  }

  function renderMessageDetail() {
    const id = Number(new URLSearchParams(location.search).get("id") || 1);
    const m = messageRows().find((row) => row.id === id) || messageRows()[0];
    $("#app").innerHTML = shell("消息详情", m.title, "", `
      <section class="h5-card"><div class="h5-card-body">
        <h2>${m.title}</h2>
        <p>${m.text}</p>
        ${kv("所属项目", m.project)}${kv("所属活动", m.activity)}${kv("通知时间", m.time)}${kv("读取状态", "已读")}
        <div class="btn-row"><a class="h5-btn primary" href="${m.href}">查看关联内容</a></div>
      </div></section>`, "messages.html");
  }

  const renderers = {
    entry: renderEntry,
    login: renderLogin,
    "identity-select": renderIdentitySelect,
    "my-activities": renderMyActivities,
    home: renderHome,
    "project-list": renderProjectList,
    "project-detail": renderProjectDetail,
    "activity-list": renderActivityList,
    "activity-detail": renderActivityDetail,
    registration: renderRegistration,
    "registration-result": renderRegistrationResult,
    "my-history": renderHistory,
    profile: renderProfile,
    agenda: renderAgenda,
    trip: renderTrip,
    "trip-edit": renderTripEdit,
    "seat-detail": renderSeat,
    "venue-map": renderVenueMap,
    invitation: renderInvitation,
    messages: renderMessages,
    "message-detail": renderMessageDetail
  };

  document.addEventListener("DOMContentLoaded", () => {
    const page = document.body.dataset.page;
    if (renderers[page]) renderers[page]();
  });
})();
