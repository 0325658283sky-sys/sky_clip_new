import { Config } from '@remotion/cli/config';
import { enableSkycutResolution } from './apps/renderer/webpack-override';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.overrideWebpackConfig(enableSkycutResolution);
