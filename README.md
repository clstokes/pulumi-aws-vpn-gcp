# VPN between AWS and GCP

A [Pulumi](https://www.pulumi.com/) application to create an AWS VPC, a
Google Cloud network, and a VPN connection between them allowing private
connectivity.

# Usage

```
# Create the stack
$ pulumi stack init pulumi-aws-vpn-gcp-vpc
# Configure your environment
$ pulumi config set baseName pulumi-aws-vpn-gcp
$ pulumi config set aws:region us-east-1
$ pulumi config set gcp:project YOUR_GCP_PROJECT
$ pulumi config set gcp:region us-west2
# Install NPM dependencies:
$ npm install
# Preview and create the deployment
$ pulumi up
Previewing update of stack 'pulumi-aws-vpn-gcp'
Previewing changes:
...

Performing changes:
...

info: 31 changes performed:
    + 31 resources created
Update duration: 6m6.3836198s
# Cleanup
$ pulumi destroy
$ pulumi stack rm
```
