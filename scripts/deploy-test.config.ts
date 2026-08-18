// 测试环境的 Rancher 配置。按部署要求纳入 Git —— 换环境直接改这里，
// 也可以用 RANCHER_REDEPLOY_URL / RANCHER_DEPLOY_TOKEN 环境变量临时覆盖。
export default {
  // 形如 https://<rancher>/v3/project/<cluster>:<project>/workloads/deployment:<namespace>:pszx-hdyy?action=redeploy
  rancherRedeployUrl: "",
  rancherDeployToken: "",
  // 自签名证书的 Rancher 需要开这个。
  insecureTls: true,
};
