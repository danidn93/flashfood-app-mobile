import ActivityKit
import WidgetKit
import SwiftUI

// Add this file to a Widget Extension target using Xcode > File > New > Target.
@available(iOS 16.1, *)
struct FlashFoodOrderLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FlashFoodOrderAttributes.self) { context in
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("FlashFood · Pedido #\(context.attributes.orderNumber)")
                        .font(.caption.bold())
                    Spacer()
                    Image(systemName: "shippingbox.fill")
                }
                Text(context.state.headline)
                    .font(.headline)
                Text(context.attributes.merchantName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let eta = context.state.estimatedArrival {
                    Text("Llegada estimada: \(eta, style: .time)")
                        .font(.caption)
                }
            }
            .padding(16)
            .activityBackgroundTint(Color.orange.opacity(0.1))
            .activitySystemActionForegroundColor(.orange)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "bicycle")
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.headline)
                        .lineLimit(2)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("Pedido #\(context.attributes.orderNumber)")
                        .font(.caption)
                }
            } compactLeading: {
                Image(systemName: "bicycle")
            } compactTrailing: {
                Text("#\(context.attributes.orderNumber)")
                    .font(.caption2)
            } minimal: {
                Image(systemName: "bicycle")
            }
        }
    }
}
