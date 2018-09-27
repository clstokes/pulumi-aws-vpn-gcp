import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as gcp from "@pulumi/gcp";

const config = new pulumi.Config();
const baseName = config.require("baseName");

const awsVpcCidr = "10.0.0.0/22";
const awsSubnetCidrs = ["10.0.0.0/24","10.0.1.0/24","10.0.2.0/24"];

const gcpVpcCidr = "10.0.4.0/22";
const gcpSubnetCidrs = ["10.0.4.0/24","10.0.5.0/24","10.0.6.0/24"];

/**
 * AWS
 */
const awsVpc = new aws.ec2.Vpc(`${baseName}-vpc`, {
  tags: { "Name": `${baseName}`, },
  cidrBlock: awsVpcCidr,
  enableDnsSupport: true,
  enableDnsHostnames: true,
} );

const awsSubnets = awsSubnetCidrs.map((cidr, index) => {
  let subnetName = `${baseName}-subnet-${index}`;
  let subnet = new aws.ec2.Subnet(subnetName, {
    tags: { "Name": `${subnetName}`, },
    vpcId: awsVpc.id,
    cidrBlock: `${cidr}`,
    mapPublicIpOnLaunch: true,
  } );
  return subnet;
} );

const awsInternetGateway = new aws.ec2.InternetGateway(`${baseName}-igw`, {
  tags: { "Name": `${baseName}-igw`, },
  vpcId: awsVpc.id,
} );

const awsVpnGateway = new aws.ec2.VpnGateway(`${baseName}-vgw`, {
  tags: { "Name": `${baseName}-vgw`, },
  vpcId: awsVpc.id,
} );

const gcpAddress = new gcp.compute.Address(`${baseName}-eip-aws-cgw`, {
  name: `${baseName}-eip-aws-cgw`,
} );

const awsCustomerGateway = new aws.ec2.CustomerGateway(`${baseName}-cgw`, {
  tags: { "Name": `${baseName}-cgw`, },
  bgpAsn: 65000,
  ipAddress: gcpAddress.address,
  type: "ipsec.1",
} );

const publicRouteTable = new aws.ec2.DefaultRouteTable(`${baseName}-rtb-default`, {
  tags: { "Name": `${baseName}-rtb-default`, },
  defaultRouteTableId: awsVpc.defaultRouteTableId,
  routes: [
    {
      cidrBlock: "0.0.0.0/0",
      gatewayId: awsInternetGateway.id,
    },
    {
      cidrBlock: `${gcpVpcCidr}`,
      gatewayId: awsVpnGateway.id,
    },
  ],
  propagatingVgws: [awsVpnGateway.id],
} );

const awsVpnConnection = new aws.ec2.VpnConnection(`${baseName}-vpn-conn`, {
  tags: { "Name": `${baseName}-vpn-conn`, },
  customerGatewayId: awsCustomerGateway.id,
  vpnGatewayId: awsVpnGateway.id,
  type: "ipsec.1",
  staticRoutesOnly: false,
} );

const awsFirewall = new aws.ec2.SecurityGroup(`${baseName}-fwl`, {
  name: `${baseName}-fwl`,
  vpcId: awsVpc.id,
  ingress: [
    { protocol: "icmp", fromPort: 8, toPort: 0, cidrBlocks: [ "0.0.0.0/0" ] },
    { protocol: "tcp", fromPort: 22, toPort: 22, cidrBlocks: [ "0.0.0.0/0" ] },
  ],
  egress: [
    { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: [ "0.0.0.0/0" ] },
  ],
} );

const awsFirewallVpn = new aws.ec2.SecurityGroup(`${baseName}-fwl-vpn`, {
  name: `${baseName}-fwl-vpn`,
  vpcId: awsVpc.id,
  ingress: [
    { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: [ `${gcpVpcCidr}` ] },
  ],
} );

export const awsVpcId = awsVpc.id;
export const awsSubnetIds = awsSubnets.map(subnet => subnet.id);

/**
 * GCP
 */
const gcpNetwork = new gcp.compute.Network(`${baseName}-vpc`, {
  name: `${baseName}-vpc`,
  autoCreateSubnetworks: false,
} );

const gcpSubnets = gcpSubnetCidrs.map((cidr, index) => {
  let subnetName = `${baseName}-subnet-${index}`;
  let subnet = new gcp.compute.Subnetwork(subnetName, {
    name: subnetName,
    network: gcpNetwork.id,
    ipCidrRange: `${cidr}`,
  } );
  return subnet;
} );

const gcpVpnGateway = new gcp.compute.VPNGateway(`${baseName}-vgw`, {
  name: `${baseName}-vgw`,
  network: gcpNetwork.id,
} );

const gcpForwardingRuleESP = new gcp.compute.ForwardingRule(`${baseName}-fr-esp`, {
  name: `${baseName}-fr-esp`,
  ipAddress: gcpAddress.address,
  ipProtocol: "ESP",
  target: gcpVpnGateway.selfLink,
} );

const gcpForwardingRuleUDP500 = new gcp.compute.ForwardingRule(`${baseName}-fr-udp500`, {
  name: `${baseName}-fr-udp500`,
  ipAddress: gcpAddress.address,
  ipProtocol: "UDP",
  portRange: "500",
  target: gcpVpnGateway.selfLink,
} );

const gcpForwardingRuleUDP4500 = new gcp.compute.ForwardingRule(`${baseName}-fr-udp4500`, {
  name: `${baseName}-fr-udp4500`,
  ipAddress: gcpAddress.address,
  ipProtocol: "UDP",
  portRange: "4500",
  target: gcpVpnGateway.selfLink,
} );

const gcpRouter0 = new gcp.compute.Router(`${baseName}-router-0`, {
  name: `${baseName}-router-0`,
  network: gcpNetwork.name,
  bgp: {
    asn: awsCustomerGateway.bgpAsn,
    advertiseMode: "DEFAULT",
  },
} );

const gcpVpnTunnel0 = new gcp.compute.VPNTunnel(`${baseName}-vpn-tunnel-0`, {
    name: `${baseName}-vpn-tunnel-0`,
    ikeVersion: 1,
    peerIp: awsVpnConnection.tunnel1Address,
    sharedSecret: awsVpnConnection.tunnel1PresharedKey,
    targetVpnGateway: gcpVpnGateway.selfLink,
    router: gcpRouter0.id,
  },
  {
      dependsOn: [gcpForwardingRuleESP, gcpForwardingRuleUDP500, gcpForwardingRuleUDP4500],
  }
);

const gcpRouterInterface0 = new gcp.compute.RouterInterface(`${baseName}-router-0-interface`, {
  name: `${baseName}-router-0-interface`,
  router: gcpRouter0.name,
  ipRange: awsVpnConnection.tunnel1CgwInsideAddress.apply(addr => `${addr}/30`),
  vpnTunnel: gcpVpnTunnel0.name,
} );

const gcpRouterPeer0 = new gcp.compute.RouterPeer(`${baseName}-router-0-peer`, {
  name: `${baseName}-router-0-peer`,
  router: gcpRouter0.name,
  peerIpAddress: awsVpnConnection.tunnel1VgwInsideAddress,
  peerAsn: 64512,
  interface: gcpRouterInterface0.name,
} );

const gcpRouter1 = new gcp.compute.Router(`${baseName}-router-1`, {
  name: `${baseName}-router-1`,
  network: gcpNetwork.name,
  bgp: {
    asn: awsCustomerGateway.bgpAsn,
    advertiseMode: "DEFAULT",
  },
} );

const gcpVpnTunnel1 = new gcp.compute.VPNTunnel(`${baseName}-vpn-tunnel-1`, {
    name: `${baseName}-vpn-tunnel-1`,
    ikeVersion: 1,
    peerIp: awsVpnConnection.tunnel2Address,
    sharedSecret: awsVpnConnection.tunnel2PresharedKey,
    targetVpnGateway: gcpVpnGateway.selfLink,
    router: gcpRouter1.id,
  },
  {
      dependsOn: [gcpForwardingRuleESP, gcpForwardingRuleUDP500, gcpForwardingRuleUDP4500],
  }
);

const gcpRouterInterface1 = new gcp.compute.RouterInterface(`${baseName}-router-1-interface`, {
  name: `${baseName}-router-1-interface`,
  router: gcpRouter1.name,
  ipRange: awsVpnConnection.tunnel2CgwInsideAddress.apply(addr => `${addr}/30`),
  vpnTunnel: gcpVpnTunnel1.name,
} );

const gcpRouterPeer1 = new gcp.compute.RouterPeer(`${baseName}-router-1-peer`, {
  name: `${baseName}-router-1-peer`,
  router: gcpRouter1.name,
  peerIpAddress: awsVpnConnection.tunnel2VgwInsideAddress,
  peerAsn: 64512,
  interface: gcpRouterInterface1.name,
} );

const gcpFirewall = new gcp.compute.Firewall(`${baseName}-fwl-internet`, {
  name: `${baseName}-fwl-internet`,
  network: gcpNetwork.selfLink,
  allows: [
    { protocol: "icmp" },
    { protocol: "tcp", ports: ["22"] },
  ],
  sourceRanges: ["0.0.0.0/0"],
} );

const gcpFirewallVpn = new gcp.compute.Firewall(`${baseName}-fwl-vpn`, {
  name: `${baseName}-fwl-vpn`,
  network: gcpNetwork.selfLink,
  allows: [
    { protocol: "icmp" },
    { protocol: "tcp", ports: ["0-65535"] },
    { protocol: "udp", ports: ["0-65535"] },
  ],
  sourceRanges: [`${awsVpcCidr}`],
} );

export const gcpVpcId = gcpNetwork.name;
export const gcpSubnetIds = gcpSubnets.map(subnet => subnet.name);
