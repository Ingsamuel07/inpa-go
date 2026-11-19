import { Platform } from 'react-native';
import AttendanceVoicePanelWeb from './attendance-voice-panel.web.js';
import AttendanceVoicePanelNative from './attendance-voice-panel.native.js';

export default function AttendanceVoicePanel(props) {
  if (Platform.OS === 'web') {
    return <AttendanceVoicePanelWeb {...props} />;
  }
  return <AttendanceVoicePanelNative {...props} />;
}
