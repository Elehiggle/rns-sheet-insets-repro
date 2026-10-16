import { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {
  Button,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';

type Routes = { Home: undefined; KeyboardSheet: undefined; FullSheet: undefined };
const Stack = createNativeStackNavigator<Routes>();

// Set false and rebuild the app for the control run.
const reproOptions = { includeKeyboardProvider: true };

function Home({ navigation }: NativeStackScreenProps<Routes, 'Home'>) {
  return (
    <View style={styles.home}>
      <Text style={styles.title}>Sheet insets reproduction</Text>
      <Button testID="open-keyboard-sheet" title="Open keyboard sheet" onPress={() => navigation.navigate('KeyboardSheet')} />
      <Button testID="open-full-sheet" title="Open full-height sheet" onPress={() => navigation.navigate('FullSheet')} />
      <Text>Keyboard case: open the sheet unfolded, fold the device, then focus its input.</Text>
      <Text>Top inset case: open and close a full-height sheet, change the system theme, then open it again.</Text>
    </View>
  );
}

function KeyboardSheet({ navigation }: NativeStackScreenProps<Routes, 'KeyboardSheet'>) {
  const [text, setText] = useState('');
  const { width, height } = useWindowDimensions();
  return (
    <View testID="keyboard-sheet" style={styles.sheet}>
      <Text testID="sheet-title" style={styles.title}>TOP OF THE SHEET</Text>
      <Text testID="window-size">Window: {Math.round(width)} × {Math.round(height)}</Text>
      <Text>The sheet should expand when the keyboard opens, including after folding or rotation.</Text>
      <TextInput
        testID="sheet-input"
        style={styles.input}
        placeholder="Focus after the configuration change"
        value={text}
        onChangeText={setText}
      />
      <Button testID="hide-keyboard" title="Hide keyboard" onPress={Keyboard.dismiss} />
      <Button testID="close-keyboard-sheet" title="Close sheet" onPress={navigation.goBack} />
    </View>
  );
}

function FullSheet({ navigation }: NativeStackScreenProps<Routes, 'FullSheet'>) {
  return (
    <View testID="full-sheet" style={styles.sheet}>
      <Text testID="full-sheet-title" style={styles.title}>TOP OF THE SHEET</Text>
      <Text>This title should remain below the system status bar.</Text>
      <Button testID="close-full-sheet" title="Close sheet" onPress={navigation.goBack} />
    </View>
  );
}

function Navigation() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Home" component={Home} />
        <Stack.Screen name="KeyboardSheet" component={KeyboardSheet} options={{ presentation: 'formSheet', sheetAllowedDetents: [0.65, 1], sheetInitialDetentIndex: 0, sheetCornerRadius: 24 }} />
        <Stack.Screen name="FullSheet" component={FullSheet} options={{ presentation: 'formSheet', sheetAllowedDetents: [1], sheetCornerRadius: 24 }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  if (!reproOptions.includeKeyboardProvider) return <Navigation />;
  return <KeyboardProvider><Navigation /></KeyboardProvider>;
}

const styles = StyleSheet.create({
  home: { flex: 1, justifyContent: 'center', gap: 20, padding: 24, backgroundColor: '#fff' },
  sheet: { flex: 1, gap: 16, padding: 24, backgroundColor: '#cfe8ff' },
  title: { fontSize: 24, fontWeight: '700', color: '#10263a' },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#48657f', borderRadius: 8, backgroundColor: '#fff', color: '#10263a', padding: 12 },
});
