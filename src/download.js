'use strict';

const core = require('@actions/core');
const tc = require('@actions/tool-cache');
const axios = require('axios');
const fs = require('fs');
const {logExecSync} = require('./exec');

const isLinux = name => name.indexOf('linux') >= 0;
const isAmd64 = name => name.indexOf('amd64') >= 0;
const isSignature = name => name.indexOf('sha256') >= 0;

const getTagInfo = async ({inputs, releaseUrl}) => {
  const headers = {};
  if (inputs.githubToken) {
    headers.Authorization = `token ${inputs.githubToken}`;
  }
  return axios({
    method: 'GET',
    url: releaseUrl,
    headers
  });
};

const downloadGitHubArtifact = async ({inputs, releaseUrl, assetPredicate}) => {
  const tagInfo = await getTagInfo({inputs, releaseUrl});
  const downloadUrl = tagInfo.data.assets.find(assetPredicate).browser_download_url;
  core.info(`Downloading from: ${downloadUrl}`);
  return tc.downloadTool(downloadUrl);
};

const downloadMinikube = async (inputs = {}) => {
  core.info(`Downloading Minikube  ${inputs.minikubeVersion}`);
  return downloadGitHubArtifact({
    inputs,
    releaseUrl: `https://api.github.com/repos/kubernetes/minikube/releases/tags/${inputs.minikubeVersion}`,
    assetPredicate: asset => isLinux(asset.name) && isAmd64(asset.name) && !isSignature(asset.name)
  });
};

const installCriCtl = async (inputs = {}) => {
  core.info(`Downloading cri-ctl`);
  const tar = await downloadGitHubArtifact({
    inputs,
    releaseUrl: 'https://api.github.com/repos/kubernetes-sigs/cri-tools/releases/latest',
    assetPredicate: asset =>
      isLinux(asset.name) && isAmd64(asset.name) && !isSignature(asset.name) && asset.name.indexOf('crictl') === 0
  });
  await tc.extractTar(tar, '/usr/local/bin');
}

const installCriDockerd = async (inputs = {}) => {
  core.info(`Downloading cri-dockerd`);
  const releaseUrl = 'https://api.github.com/repos/Mirantis/cri-dockerd/releases/latest';
  const binaryTar = await downloadGitHubArtifact({
    inputs,
    releaseUrl,
    assetPredicate: asset =>
      isLinux(asset.name) && isAmd64(asset.name) && !isSignature(asset.name) && asset.name.indexOf('cri-dockerd') === 0
  });
  await tc.extractTar(binaryTar, '/usr/local/bin');
  const tagInfo = await getTagInfo({inputs, releaseUrl});
  const tag = tagInfo.data.name;
  const sourceTar = await tc.downloadTool(`https://github.com/Mirantis/cri-dockerd/archive/refs/tags/${tag}.tar.gz`);
  const sourceDir = await tc.extractTar(sourceTar);
  const sourceContent = fs.readdirSync(sourceDir, {withFileTypes: true}).filter(f => f.isDirectory()).map(f => f.name)[0];
  logExecSync(`sudo cp -a ${sourceDir}/${sourceContent}/packaging/systemd/* /etc/systemd/system`);
  const serviceFile = '/etc/systemd/system/cri-docker.service';
  fs.writeFileSync(serviceFile, fs.readFileSync(serviceFile).toString()
    .replace(/\/usr\/bin\/cri-dockerd/g, '/usr/local/bin/cri-dockerd')
  );
  const socketFile = '/etc/systemd/system/cri-docker.socket';
  fs.writeFileSync(socketFile, fs.readFileSync(socketFile).toString()
    .replace(/cri-docker.sock/g, 'cri-dockerd.sock')
  );
  logExecSync('sudo systemctl daemon-reload');
  logExecSync('sudo systemctl enable cri-docker.service');
  logExecSync('sudo systemctl enable --now cri-docker.socket');
};

module.exports = {downloadMinikube, installCriCtl, installCriDockerd};
