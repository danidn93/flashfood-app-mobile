import WidgetKit
import SwiftUI

@main
struct FlashFoodOrderWidgets: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.1, *) {
            FlashFoodOrderLiveActivity()
        }
    }
}
