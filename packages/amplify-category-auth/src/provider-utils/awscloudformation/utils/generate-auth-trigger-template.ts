import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import * as cdk from '@aws-cdk/core';
import { CustomResource } from '@aws-cdk/core';
import { prepareApp } from '@aws-cdk/core/lib/private/prepare-app';
import { JSONUtilities, pathManager } from 'amplify-cli-core';
import * as fs from 'fs-extra';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import { authTriggerAssetFilePath } from '../constants';
import { AuthTriggerConnection, CognitoStackOptions } from '../service-walkthrough-types/cognito-user-input-types';

type CustomResourceAuthStackProps = Readonly<{
  description: string;
  authTriggerConnections: AuthTriggerConnection[];
  permissions?: AuthTriggerPermissions[];
}>;

const CFN_TEMPLATE_FORMAT_VERSION = '2010-09-09';

/**
 * CDK stack for custom auth resources
 */
export class CustomResourceAuthStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: CustomResourceAuthStackProps) {
    super(scope, id, props);
    this.templateOptions.templateFormatVersion = CFN_TEMPLATE_FORMAT_VERSION;

    const env = new cdk.CfnParameter(this, 'env', {
      type: 'String',
    });

    const userpoolId = new cdk.CfnParameter(this, 'userpoolId', {
      type: 'String',
    });

    const userpoolArn = new cdk.CfnParameter(this, 'userpoolArn', {
      type: 'String',
    });

    // eslint-disable-next-line no-new
    new cdk.CfnCondition(this, 'ShouldNotCreateEnvResources', {
      expression: cdk.Fn.conditionEquals(env, 'NONE'),
    });

    props.authTriggerConnections.forEach(triggerConfig => {
      const config = triggerConfig;
      const fnName = new cdk.CfnParameter(this, `function${config.lambdaFunctionName}Name`, {
        type: 'String',
      });
      const fnArn = new cdk.CfnParameter(this, `function${config.lambdaFunctionName}Arn`, {
        type: 'String',
      });
      createPermissionToInvokeLambda(this, fnName, userpoolArn, config);
      if (!_.isEmpty(props.permissions)) {
        const roleArn = new cdk.CfnParameter(this, `function${config.lambdaFunctionName}LambdaExecutionRole`, {
          type: 'String',
        });
        const lambdaPermission = props.permissions!.find(permission => config.triggerType === permission.trigger);
        if (!_.isEmpty(lambdaPermission)) {
          createPermissionsForAuthTrigger(this, fnName, roleArn, lambdaPermission!, userpoolArn);
        }
        config.lambdaFunctionArn = fnArn.valueAsString;
      }
    });

    createCustomResource(this, props.authTriggerConnections, userpoolId);
  }

  /**
   * Generates a CFN template from the CDK stack
   */
  toCloudFormation(): Record<string, unknown> {
    prepareApp(this);
    return this._toCloudFormation();
  }
}

/**
 * Creates nested auth trigger CFN template and writes it to the project directory
 */
export const generateNestedAuthTriggerTemplate = async (
  category: string,
  resourceName: string,
  request: CognitoStackOptions,
): Promise<void> => {
  const cfnFileName = 'auth-trigger-cloudformation-template.json';
  const targetDir = path.join(pathManager.getBackendDirPath(), category, resourceName, 'build');
  const authTriggerCfnFilePath = path.join(targetDir, cfnFileName);
  const { authTriggerConnections, permissions } = request;
  if (!_.isEmpty(authTriggerConnections)) {
    // eslint-disable-next-line spellcheck/spell-checker
    const cfnObject = await createCustomResourceforAuthTrigger(authTriggerConnections!, permissions);
    JSONUtilities.writeJson(authTriggerCfnFilePath, cfnObject);
  } else {
    // delete the custom stack template if the triggers aren't defined
    try {
      fs.unlinkSync(authTriggerCfnFilePath);
    } catch (err) {
      // if its not present do nothing
    }
  }
};

/**
 * creates custom resource for cognito triggers
 */
// eslint-disable-next-line spellcheck/spell-checker
export const createCustomResourceforAuthTrigger = async (
  authTriggerConnections: AuthTriggerConnection[],
  permissions?: AuthTriggerPermissions[],
): Promise<$TSAny> => {
  if (Array.isArray(authTriggerConnections) && authTriggerConnections.length) {
    const stack = new CustomResourceAuthStack(undefined as $TSAny, 'Amplify', {
      description: 'Custom Resource stack for Auth Trigger created using Amplify CLI',
      authTriggerConnections,
      permissions,
    });
    const cfn = stack.toCloudFormation();
    return cfn;
  }
  throw new Error('Auth Trigger Connections must have value when trigger are selected');
};

const createCustomResource = (
  stack: cdk.Stack,
  authTriggerConnections: AuthTriggerConnection[],
  userpoolId: cdk.CfnParameter,
): CustomResource => {
  const triggerCode = fs.readFileSync(authTriggerAssetFilePath, 'utf-8');
  const authTriggerFn = new lambda.Function(stack, 'authTriggerFn', {
    runtime: lambda.Runtime.NODEJS_14_X,
    code: lambda.Code.fromInline(triggerCode),
    handler: 'index.handler',
  });
  // reason to add iam::PassRole
  // AccessDeniedException: User: <IAM User> is not authorized to perform: iam:PassRole on resource: <auth trigger role>
  if (authTriggerFn.role) {
    authTriggerFn.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:DescribeUserPool', 'cognito-idp:DescribeUserPoolClient', 'cognito-idp:UpdateUserPool', 'iam:PassRole'],
        resources: ['*'],
      }),
    );
  }

  // The custom resource that uses the provider to supply value
  // Passing in a nonce parameter to ensure that the custom resource is triggered on every deployment
  return new CustomResource(stack, 'CustomAuthTriggerResource', {
    serviceToken: authTriggerFn.functionArn,
    properties: { userpoolId: userpoolId.valueAsString, lambdaConfig: authTriggerConnections, nonce: uuid() },
    resourceType: 'Custom::CustomAuthTriggerResourceOutputs',
  });
};

const createPermissionToInvokeLambda = (
  stack: cdk.Stack,
  fnName: cdk.CfnParameter,
  userpoolArn: cdk.CfnParameter,
  config: AuthTriggerConnection,
): void => {
  // eslint-disable-next-line no-new
  new lambda.CfnPermission(stack, `UserPool${config.triggerType}LambdaInvokePermission`, {
    action: 'lambda:InvokeFunction',
    functionName: fnName.valueAsString,
    principal: 'cognito-idp.amazonaws.com',
    sourceArn: userpoolArn.valueAsString,
  });
}

const createPermissionsForAuthTrigger = (
  stack: cdk.Stack,
  fnName: cdk.CfnParameter,
  roleArn: cdk.CfnParameter,
  permissions: AuthTriggerPermissions,
  userpoolArn: cdk.CfnParameter,
): iam.Policy => {
  const myRole = iam.Role.fromRoleArn(stack, 'LambdaExecutionRole', roleArn.valueAsString);
  return new iam.Policy(stack, `${fnName}${permissions.trigger}${permissions.policyName}`, {
    policyName: permissions.policyName,
    statements: [
      new iam.PolicyStatement({
        effect: permissions.effect === iam.Effect.ALLOW ? iam.Effect.ALLOW : iam.Effect.DENY,
        actions: permissions.actions,
        resources: [userpoolArn.valueAsString],
      }),
    ],
    roles: [myRole],
  });
};
