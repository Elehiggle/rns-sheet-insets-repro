// Production methods replace the markers; the remaining types are JVM doubles.
interface LifecycleOwner
interface LifecycleEventObserver {
    fun onStateChanged(source: LifecycleOwner, event: Lifecycle.Event)
}
class Lifecycle {
    enum class Event { ON_CREATE, ON_START, ON_RESUME, ON_PAUSE, ON_STOP, ON_DESTROY }
}
class ScreenStackFragment : LifecycleOwner { var sheetDelegate: SheetDelegate? = null }
fun ScreenStackFragment.asScreenStackFragment() = this

open class View {
    val windowToken = Any()
    var keyboardVisible = true
    var focusRequests = 0
    open fun onAttachedToWindow() = Unit
    fun requestFocus(): Boolean {
        focusRequests += 1
        return true
    }
}
class Window { val decorView = View() }
class Activity { val window = Window(); var currentFocus: View? = View() }
class InputMethodManager {
    var hides = 0
    var shows = 0
    fun hideSoftInputFromWindow(token: Any, flags: Int) { hides += 1 }
    fun showSoftInput(view: View, flags: Int) { shows += 1 }
}
class ReactContext { var currentActivity: Activity? = Activity() }
fun isSoftKeyboardVisibleOrNull(view: View): Boolean? = view.keyboardVisible
class WindowInsetsCompat
interface OnApplyWindowInsetsListener {
    fun onApplyWindowInsets(v: View, insets: WindowInsetsCompat): WindowInsetsCompat
}
object ViewCompat {
    var requestedPasses = 0
    fun requestApplyInsets(view: View) { requestedPasses += 1 }
    fun getRootWindowInsets(view: View): WindowInsetsCompat? = null
}

class Screen : View() {
    val reactContext = ReactContext()
    var fragment: ScreenStackFragment? = ScreenStackFragment()
    fun usesFormSheetPresentation() = true
    // @SCREEN_ATTACH@
}

object InsetsObserverProxy : OnApplyWindowInsetsListener {
    private val listeners: HashSet<OnApplyWindowInsetsListener> = hashSetOf()
    private var observedView: View? = null
    fun reset() { listeners.clear(); observedView = null; ViewCompat.requestedPasses = 0 }
    fun contains(listener: OnApplyWindowInsetsListener) = listeners.contains(listener)
    fun size() = listeners.size
    fun registerOnView(view: View): Boolean { observedView = view; return true }
    private fun getObservedView() = observedView
    // @PROXY_METHODS@
}

class SheetDelegate(val screen: Screen) : LifecycleEventObserver, OnApplyWindowInsetsListener {
    private var viewToRestoreFocus: View? = null
    val inputMethodManager = InputMethodManager()
    var insetCallbacks = 0
    private fun requireDecorView() = checkNotNull(screen.reactContext.currentActivity).window.decorView
    override fun onApplyWindowInsets(v: View, insets: WindowInsetsCompat): WindowInsetsCompat {
        insetCallbacks += 1
        return insets
    }
    // @DELEGATE_METHODS@
}

class Fixture {
    val screen = Screen()
    val fragment = checkNotNull(screen.fragment)
    val delegate = SheetDelegate(screen)
    val activity = checkNotNull(screen.reactContext.currentActivity)
    val priorFocus = checkNotNull(activity.currentFocus)
    init { fragment.sheetDelegate = delegate }
    fun event(event: Lifecycle.Event) = delegate.onStateChanged(fragment, event)
    fun attach() = screen.onAttachedToWindow()
    fun deliverInsets() {
        val insets = WindowInsetsCompat()
        check(InsetsObserverProxy.onApplyWindowInsets(activity.window.decorView, insets) === insets)
    }
}

fun main() {
    var failures = 0
    fun test(name: String, body: () -> Unit) {
        InsetsObserverProxy.reset()
        try {
            body()
            println("PASS $name")
        } catch (failure: Throwable) {
            failures += 1
            println("FAIL $name: ${failure.message}")
        }
    }

    test("destroyed-before-resume") {
        val f = Fixture()
        f.event(Lifecycle.Event.ON_CREATE)
        f.attach()
        check(InsetsObserverProxy.contains(f.delegate)) { "attach must subscribe before resume" }
        f.deliverInsets()
        check(f.delegate.insetCallbacks == 1) { "early subscription must receive insets" }
        f.event(Lifecycle.Event.ON_START)
        f.deliverInsets()
        check(f.delegate.insetCallbacks == 2) { "start must preserve early subscription" }
        // A STARTED fragment can stop and be destroyed without ever entering RESUMED.
        f.event(Lifecycle.Event.ON_STOP)
        f.event(Lifecycle.Event.ON_DESTROY)
        val retained = InsetsObserverProxy.contains(f.delegate)
        f.deliverInsets()
        check(!retained && f.delegate.insetCallbacks == 2) {
            "destroy retained delegate=$retained; post-destroy inset callbacks=${f.delegate.insetCallbacks - 2}"
        }
        check(InsetsObserverProxy.size() == 0)
    }

    test("normal-pause-destroy-is-idempotent") {
        val f = Fixture()
        f.event(Lifecycle.Event.ON_CREATE)
        f.attach()
        f.event(Lifecycle.Event.ON_START)
        f.event(Lifecycle.Event.ON_RESUME)
        check(InsetsObserverProxy.size() == 1) { "resume must not duplicate attach subscription" }
        f.deliverInsets()
        f.event(Lifecycle.Event.ON_PAUSE)
        check(!InsetsObserverProxy.contains(f.delegate)) { "pause must still remove the listener" }
        f.deliverInsets()
        check(f.delegate.insetCallbacks == 1)
        f.event(Lifecycle.Event.ON_STOP)
        f.event(Lifecycle.Event.ON_DESTROY)
        f.event(Lifecycle.Event.ON_DESTROY) // defensive duplicate: removal remains harmless
        f.deliverInsets()
        check(InsetsObserverProxy.size() == 0 && f.delegate.insetCallbacks == 1)
        check(f.priorFocus.focusRequests == 1 && f.delegate.inputMethodManager.shows == 1)
    }

    test("other-early-subscription-survives-destroy") {
        val destroyed = Fixture()
        val live = Fixture()
        destroyed.attach()
        destroyed.event(Lifecycle.Event.ON_START)
        live.attach()
        check(InsetsObserverProxy.size() == 2)
        destroyed.event(Lifecycle.Event.ON_DESTROY)
        live.deliverInsets()
        check(InsetsObserverProxy.contains(live.delegate) && live.delegate.insetCallbacks == 1) {
            "destroy must preserve another sheet's legitimate early subscription"
        }
        check(destroyed.delegate.insetCallbacks == 0 && InsetsObserverProxy.size() == 1) {
            "destroyed delegate still receives insets alongside the live sheet"
        }
    }

    test("focus-restoration-still-runs") {
        val f = Fixture()
        f.event(Lifecycle.Event.ON_CREATE)
        check(f.screen.focusRequests == 1 && f.delegate.inputMethodManager.hides == 1)
        f.attach()
        f.event(Lifecycle.Event.ON_START)
        f.event(Lifecycle.Event.ON_STOP)
        f.event(Lifecycle.Event.ON_DESTROY)
        check(f.priorFocus.focusRequests == 1 && f.delegate.inputMethodManager.shows == 1) {
            "destroy must restore prior focus and request the keyboard"
        }
        f.event(Lifecycle.Event.ON_DESTROY)
        check(f.priorFocus.focusRequests == 1 && f.delegate.inputMethodManager.shows == 1) {
            "restored focus reference must still be cleared"
        }
    }
    check(failures == 0) { "$failures lifecycle checks failed" }
    println("PASS all 4 lifecycle checks")
}
