import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export class EcsDeployCdkBgStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: 'ecs-bg-test-cluster',
    });

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
    });

    taskDefinition.addContainer('nginx', {
      image: ecs.ContainerImage.fromRegistry('nginx:latest'),
      portMappings: [{ containerPort: 80 }],
      command: [
        'sh', '-c',
        `echo '<html><body><h1>Version: v1</h1></body></html>' > /usr/share/nginx/html/index.html && nginx -g 'daemon off;'`,
      ],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'ecs',
      }),
    });

    // ALB
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
    });

    // --- ブルー/グリーンデプロイメント ---

    // 本番用リスナー
    const prodListener = alb.addListener('Listener', {
      port: 80,
      defaultAction: elbv2.ListenerAction.fixedResponse(404),
    });

    // テスト用リスナー（オプション）
    const testListener = alb.addListener('TestListener', {
      port: 8080,
      defaultAction: elbv2.ListenerAction.fixedResponse(404),
    });

    // ブルー用ターゲットグループ
    const blueTargetGroup = new elbv2.ApplicationTargetGroup(this, 'BlueTargetGroup', {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/',
      },
    });

    // グリーン用ターゲットグループ
    const greenTargetGroup = new elbv2.ApplicationTargetGroup(this, 'GreenTargetGroup', {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/',
      },
    });

    // 本番用リスナールール
    const prodListenerRule = new elbv2.ApplicationListenerRule(this, 'ProdListenerRule', {
      listener: prodListener,
      priority: 1,
      conditions: [elbv2.ListenerCondition.pathPatterns(['*'])],
      targetGroups: [blueTargetGroup],
    });

    // テスト用リスナールール（オプション）
    new elbv2.ApplicationListenerRule(this, 'TestListenerRule', {
      listener: testListener,
      priority: 1,
      conditions: [elbv2.ListenerCondition.pathPatterns(['*'])],
      targetGroups: [blueTargetGroup],
    });

    // ECS Service
    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      deploymentStrategy: ecs.DeploymentStrategy.BLUE_GREEN,
    });

    const target = service.loadBalancerTarget({
      containerName: 'nginx',
      containerPort: 80,
      protocol: ecs.Protocol.TCP,
      alternateTarget: new ecs.AlternateTarget('AlternateTarget', {
        alternateTargetGroup: greenTargetGroup,
        productionListener: ecs.ListenerRuleConfiguration.applicationListenerRule(prodListenerRule),
      }),
    });

    target.attachToApplicationTargetGroup(blueTargetGroup);

    // --- ローリングアップデート（変更前） ---
    // const listener = alb.addListener('Listener', {
    //   port: 80,
    // });
    //
    // const service = new ecs.FargateService(this, 'Service', {
    //   cluster,
    //   taskDefinition,
    //   desiredCount: 1,
    // });
    //
    // listener.addTargets('ECSTarget', {
    //   port: 80,
    //   targets: [
    //     service.loadBalancerTarget({
    //       containerName: 'nginx',
    //       containerPort: 80,
    //     }),
    //   ],
    //   healthCheck: {
    //     path: '/',
    //   },
    // });

    // Output ALB DNS
    new cdk.CfnOutput(this, 'ALBDnsName', {
      value: alb.loadBalancerDnsName,
    });
  }
}
